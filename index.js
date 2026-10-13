/**
 * Token Wallet — a SillyTavern extension that shows how much every generation costs.
 *
 * A wallet sits on the screen; for every request a coin with the input cost flies out of it,
 * and when the reply is ready a second coin shows the output cost. OpenRouter reports the exact
 * billed amount in every response, other providers are priced from the OpenRouter catalog or
 * from user-defined prices.
 */

import { installFetchInterceptor } from './src/interceptor.js';
import {
    PriceCatalog,
    compactCatalogModel,
    computeCost,
    estimateInputCost,
    findCustomPrice,
    parseCustomPrices,
} from './src/pricing.js';
import { FALLBACK_USD_RUB, fetchUsdRubRate, formatMoney } from './src/currency.js';
import { setLang, t, getLocale } from './src/i18n.js';
import { WalletUI } from './src/ui.js';
import { DEFAULT_WALLET, WALLETS } from './src/wallets.js';
import {
    EMBEDDING_CATALOG_SOURCE,
    EMBEDDING_FALLBACK_PRICES,
    PAID_EMBEDDING_SOURCES,
    isOpenAiEmbeddingModel,
    stripMessageOverhead,
} from './src/embeddings.js';
import { SettingsPanel, formatDate } from './src/settings-ui.js';

const MODULE = 'token_wallet';
const META_KEY = 'token_wallet';
const EXTRA_KEY = 'token_wallet';
const CATALOG_STORAGE_KEY = 'token_wallet_catalog_v2';
const CATALOG_MAX_AGE = 12 * 60 * 60 * 1000;
const RATE_MAX_AGE = 6 * 60 * 60 * 1000;
const HISTORY_LIMIT = 40;
const DAYS_LIMIT = 62;
const LOG = '[Token Wallet]';

/** Sources that are always billed. `custom` and local text completion backends are not. */
const FREE_OR_UNKNOWN_SOURCES = new Set(['custom']);

const DEFAULTS = Object.freeze({
    enabled: true,
    lang: 'ru',
    currency: 'RUB',
    rateMode: 'auto',
    manualRate: FALLBACK_USD_RUB,
    rate: null,
    inputTiming: 'send',
    wallet: DEFAULT_WALLET,
    shine: true,
    size: 'm',
    showWallet: true,
    showChatTotal: true,
    showMessageCost: true,
    showModelOnCoin: true,
    trackBackground: true,
    trackEmbeddings: true,
    embeddingCoins: false,
    position: null,
    customPrices: '',
    stats: null,
});

/* ------------------------------------------------------------------ state */

let catalog = new PriceCatalog({});
let catalogFetchedAt = 0;
let catalogPromise = null;
let catalogError = false;
/** After a failed download the catalog is not requested again until this time */
let catalogRetryAt = 0;
let rateError = false;
let customRulesCache = { text: null, rules: [] };
let recordSeq = 0;
/** @type {Set<any>} */
const pending = new Set();
/** Foreground generations waiting to be attached to a chat message */
let awaitingMessage = [];
/** The Generate() call currently running (text completion requests do not carry their type) */
let activeGeneration = null;
/** Vector Storage requests that follow each other (several insert batches) are merged into one history entry and coin */
let embeddingBatch = null;
const EMBEDDING_BATCH_DELAY = 2500;
const embeddingFallbackCatalog = new PriceCatalog(EMBEDDING_FALLBACK_PRICES);

const ui = new WalletUI({
    settings: () => settings(),
    save: () => save(),
    money: (usd, opts) => money(usd, opts),
    rate: () => usdRubRate(),
    rateIsFallback: () => settings().rateMode === 'auto' && !(Number(settings().rate?.value) > 0),
    chatTotals: () => chatTotals(),
    todayTotals: () => settings().stats.days[dayKey()] || null,
    allTotals: () => settings().stats.allTime,
    history: () => settings().stats.history,
    openSettings: () => settingsPanel.open(),
    refreshAll: () => refreshAll(),
});

const settingsPanel = new SettingsPanel({
    settings: () => settings(),
    save: () => save(),
    refreshAll: (opts) => refreshAll(opts),
    rateStatus: () => rateStatus(),
    refreshRate: (force) => refreshRate(force),
    catalogStatus: () => catalogStatus(),
    refreshCatalog: (force) => refreshCatalog(force).catch(() => { }),
    customRuleCount: () => customRules().length,
    resetChatStats: () => resetChatStats(),
    resetAllStats: () => resetAllStats(),
    resetPosition: () => ui.resetPosition(),
    testAnimation: () => testAnimation(),
});

/* --------------------------------------------------------------- helpers */

function ctx() {
    return SillyTavern.getContext();
}

function emptyTotals() {
    return { usd: 0, inUsd: 0, outUsd: 0, tokIn: 0, tokOut: 0, count: 0, unpriced: 0 };
}

function addToTotals(totals, entry) {
    const target = totals || emptyTotals();
    target.count = (target.count || 0) + 1;
    target.tokIn = (target.tokIn || 0) + (entry.tokIn || 0);
    target.tokOut = (target.tokOut || 0) + (entry.tokOut || 0);
    if (entry.usd === null || entry.usd === undefined) {
        target.unpriced = (target.unpriced || 0) + 1;
    } else {
        target.usd = (target.usd || 0) + entry.usd;
        target.inUsd = (target.inUsd || 0) + entry.inUsd;
        target.outUsd = (target.outUsd || 0) + entry.outUsd;
    }
    return target;
}

function settings() {
    const store = ctx().extensionSettings;
    if (!store[MODULE]) store[MODULE] = {};
    const s = store[MODULE];
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (s[key] === undefined) s[key] = value;
    }
    if (!s.stats || typeof s.stats !== 'object') s.stats = {};
    if (!s.stats.allTime) s.stats.allTime = emptyTotals();
    if (!s.stats.days || typeof s.stats.days !== 'object') s.stats.days = {};
    if (!Array.isArray(s.stats.history)) s.stats.history = [];
    if (!WALLETS.some(w => w.id === s.wallet)) s.wallet = DEFAULT_WALLET;
    return s;
}

function save() {
    ctx().saveSettingsDebounced();
}

function dayKey(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function usdRubRate() {
    const s = settings();
    if (s.rateMode === 'manual' && Number(s.manualRate) > 0) return Number(s.manualRate);
    return Number(s.rate?.value) > 0 ? Number(s.rate.value) : (Number(s.manualRate) > 0 ? Number(s.manualRate) : FALLBACK_USD_RUB);
}

function money(usd, opts) {
    return formatMoney(usd || 0, settings().currency, usdRubRate(), opts);
}

function currentChatId() {
    try {
        return ctx().getCurrentChatId() ?? null;
    } catch {
        return null;
    }
}

function chatTotals() {
    if (!currentChatId()) return null;
    return ctx().chatMetadata?.[META_KEY] || null;
}

function customRules() {
    const text = settings().customPrices || '';
    if (customRulesCache.text !== text) {
        customRulesCache = { text, rules: parseCustomPrices(text) };
    }
    return customRulesCache.rules;
}

function catalogSource(source) {
    if (source === 'tc:openrouter') return 'openrouter';
    if (source.startsWith('emb:')) return EMBEDDING_CATALOG_SOURCE[source.slice(4)] || source;
    return source;
}

/**
 * @param {string} source
 * @param {(string|null|undefined)[]} models Candidates, most reliable first
 * @param {boolean} [preferCatalog] Catalog before custom prices (used to split an exact OpenRouter bill)
 */
function lookupPrice(source, models, preferCatalog = false) {
    const ids = [...new Set(models.filter(Boolean))];
    const fromCustom = () => {
        for (const id of ids) {
            const price = findCustomPrice(customRules(), id);
            if (price) return price;
        }
        return null;
    };
    const fromCatalog = () => {
        for (const id of ids) {
            const price = catalog.find(catalogSource(source), id);
            if (price) return price;
        }
        return null;
    };
    const fromFallback = () => {
        if (!source.startsWith('emb:')) return null;
        for (const id of ids) {
            const price = embeddingFallbackCatalog.find(catalogSource(source), id);
            if (price) return price;
        }
        return null;
    };
    return (preferCatalog ? (fromCatalog() || fromCustom()) : (fromCustom() || fromCatalog())) || fromFallback();
}

function guessTokens(text) {
    return Math.ceil(String(text || '').length / 3.35);
}

function messageText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))).join('\n');
    }
    return '';
}

/* ---------------------------------------------------------------- prices */

function loadCatalogFromStorage() {
    try {
        localStorage.removeItem('token_wallet_catalog_v1'); // older format without embedding models
        const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data?.models && typeof data.models === 'object') {
            catalog = new PriceCatalog(data.models);
            catalogFetchedAt = Number(data.fetchedAt) || 0;
        }
    } catch {
        // storage unavailable or corrupted
    }
}

async function fetchPublicModels(query = '') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`https://openrouter.ai/api/v1/models${query}`, { signal: controller.signal });
        if (!response.ok) return null;
        const json = await response.json();
        return Array.isArray(json?.data) && json.data.length ? json.data : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchCatalogList() {
    // 1) Public endpoint, straight from the browser (no API key needed).
    //    Embedding models (Vector Storage) are listed separately.
    const [chatModels, embeddingModels] = await Promise.all([
        fetchPublicModels(),
        fetchPublicModels('?output_modalities=embeddings'),
    ]);
    if (chatModels) return [...chatModels, ...(embeddingModels || [])];

    // 2) Through the SillyTavern server (uses the OpenRouter key saved in SillyTavern)
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: ctx().getRequestHeaders(),
        body: JSON.stringify({ chat_completion_source: 'openrouter' }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : null);
    if (!list?.length) throw new Error('Empty model list');
    return list;
}

async function refreshCatalog(force = false) {
    if (!force && catalog.size > 0 && Date.now() - catalogFetchedAt < CATALOG_MAX_AGE) return;
    if (!force && Date.now() < catalogRetryAt) return;
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
        settingsPanel.updateStatus();
        try {
            const list = await fetchCatalogList();
            const models = {};
            for (const model of list) {
                if (typeof model?.id !== 'string') continue;
                const price = compactCatalogModel(model);
                if (price) models[model.id] = price;
            }
            catalog = new PriceCatalog(models);
            catalogFetchedAt = Date.now();
            catalogError = false;
            catalogRetryAt = 0;
            try {
                localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify({ fetchedAt: catalogFetchedAt, models }));
            } catch {
                // quota exceeded / private mode
            }
        } catch (error) {
            catalogError = true;
            catalogRetryAt = Date.now() + 10 * 60 * 1000;
            console.warn(LOG, 'Could not load the OpenRouter price catalog', error);
            throw error;
        }
    })().finally(() => {
        catalogPromise = null;
        settingsPanel.updateStatus();
    });
    return catalogPromise;
}

/** Waits for the catalog if it is being loaded, but not longer than `timeoutMs` */
async function catalogReady(timeoutMs = 4000) {
    if (!catalogPromise && (catalog.size > 0 || Date.now() < catalogRetryAt)) return;
    const loading = catalogPromise || refreshCatalog().catch(() => { });
    await Promise.race([loading, new Promise(resolve => setTimeout(resolve, timeoutMs))]).catch(() => { });
}

function catalogStatus() {
    if (catalogPromise && catalog.size === 0) return t('catalog_loading');
    if (catalog.size === 0) return catalogError ? t('catalog_failed') : t('catalog_missing');
    const date = new Date(catalogFetchedAt).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return t('catalog_status', { n: catalog.size, date });
}

/* ----------------------------------------------------------------- rates */

async function refreshRate(force = false) {
    const s = settings();
    if (s.rateMode !== 'auto') return;
    if (!force && s.rate?.fetchedAt && Date.now() - s.rate.fetchedAt < RATE_MAX_AGE) return;
    try {
        s.rate = await fetchUsdRubRate();
        rateError = false;
        save();
    } catch (error) {
        rateError = true;
        console.warn(LOG, 'Could not load the exchange rate', error);
    }
    refreshAll({ keepSettings: true });
    settingsPanel.updateStatus();
}

function rateStatus() {
    const s = settings();
    const rate = usdRubRate().toLocaleString(getLocale(), { maximumFractionDigits: 4 });
    if (s.rateMode === 'manual') return t('rate_manual_status', { rate });
    if (s.rate?.value) {
        const status = t('rate_status', { rate, source: s.rate.source, date: formatDate(s.rate.date) });
        return rateError ? `${status} · ${t('rate_failed')}` : status;
    }
    return rateError ? t('rate_failed_using', { rate }) : t('rate_unknown', { rate });
}

/* ------------------------------------------------------- token estimates */

async function countMessagesTokens(messages) {
    const c = ctx();
    const model = (typeof c.getTokenizerModel === 'function' && c.getTokenizerModel()) || 'gpt-4o';
    const response = await fetch(`/api/tokenizers/openai/count?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: c.getRequestHeaders(),
        body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const count = Number(json?.token_count);
    if (!Number.isFinite(count)) throw new Error('Bad token count');
    return count;
}

/** Prompt size estimate, used before the provider reports usage or when it does not report it at all */
function estimatePromptTokens(record) {
    if (!record.promptTokensPromise) {
        record.promptTokensPromise = (async () => {
            const body = record.info.body;
            if (Array.isArray(body.messages)) {
                const messages = body.messages
                    .filter(m => m && typeof m === 'object')
                    .map((m) => {
                        const message = { role: String(m.role || 'user'), content: messageText(m.content) };
                        if (typeof m.name === 'string' && m.name) message.name = m.name;
                        return message;
                    });
                try {
                    return await countMessagesTokens(messages);
                } catch {
                    return guessTokens(messages.map(m => m.content).join('\n'));
                }
            }
            const text = typeof body.prompt === 'string' ? body.prompt : (typeof body.messages === 'string' ? body.messages : '');
            try {
                const count = await ctx().getTokenCountAsync(text);
                return Number.isFinite(count) ? count : guessTokens(text);
            } catch {
                return guessTokens(text);
            }
        })();
    }
    return record.promptTokensPromise;
}

async function estimateTextTokens(text) {
    if (!text) return 0;
    try {
        const count = await ctx().getTokenCountAsync(text);
        return Number.isFinite(count) ? count : guessTokens(text);
    } catch {
        return guessTokens(text);
    }
}

/* ------------------------------------------------------------ generation */

function isEnabled() {
    try {
        return settings().enabled !== false;
    } catch {
        return true;
    }
}

/**
 * Called by the fetch interceptor when SillyTavern sends a generation request.
 * @param {import('./src/interceptor.js').RequestInfo} info
 */
function onRequestStart(info) {
    const s = settings();
    let type = info.type;

    if (info.kind === 'embedding') {
        if (!s.trackEmbeddings) return null;
        const source = info.embedding.source;
        if (!PAID_EMBEDDING_SOURCES.has(source) && !findCustomPrice(customRules(), info.model)) return null;
        return { id: ++recordSeq, t0: Date.now(), info, type: 'embedding', background: true, chatId: currentChatId() };
    }

    if (info.kind === 'text') {
        // Only OpenRouter (or a backend the user priced manually) costs money in text completion mode
        if (info.source !== 'tc:openrouter' && !findCustomPrice(customRules(), info.model)) return null;
        type = activeGeneration && Date.now() - activeGeneration.t < 30 * 60 * 1000 ? activeGeneration.type : undefined;
    }

    const background = !type || type === 'quiet';
    if (background && !s.trackBackground) return null;

    const record = {
        id: ++recordSeq,
        t0: Date.now(),
        info,
        type: type || 'background',
        background,
        chatId: currentChatId(),
        mesId: null,
        swipeId: null,
        entry: null,
        applied: false,
        finishing: false,
        inputCoin: null,
        inputPromise: null,
        promptTokensPromise: null,
    };

    pending.add(record);
    ui.setBusy(true);

    if (!background && type !== 'impersonate') {
        awaitingMessage.push(record);
        if (awaitingMessage.length > 10) awaitingMessage = awaitingMessage.slice(-10);
    }

    if (s.inputTiming === 'send') {
        record.inputPromise = launchEstimatedInputCoin(record).catch(error => console.debug(LOG, error));
    }
    return record;
}

/** "Right on send" mode: input coin with an estimate, corrected when the bill arrives */
async function launchEstimatedInputCoin(record) {
    await catalogReady(2500);
    if (record.finishing) return;
    const price = lookupPrice(record.info.source, [record.info.model]);
    if (!price) return; // unknown model yet (e.g. OpenRouter "website default") - shown with the reply
    const tokens = await estimatePromptTokens(record);
    if (record.finishing) return;
    const usd = estimateInputCost(tokens, price);
    record.inputCoin = { usd, tokens };
    ui.launchCoin({
        kind: 'input',
        usd,
        tokens,
        model: record.info.model,
        estimated: true,
        background: record.background,
    });
}

/**
 * Called when the response copy has been read completely.
 * @param {any} record
 * @param {import('./src/interceptor.js').ResponseResult} result
 */
async function onRequestFinish(record, result) {
    if (record.info.kind === 'embedding') {
        if (result.ok) addEmbedding(record).catch(error => console.warn(LOG, 'Could not count embeddings', error));
        return;
    }
    record.finishing = true;
    pending.delete(record);
    ui.setBusy(pending.size > 0);
    try {
        await record.inputPromise;
    } catch {
        // ignore
    }

    try {
        await finishRecord(record, result);
    } catch (error) {
        console.warn(LOG, 'Could not process the generation', error);
    }
}

async function finishRecord(record, result) {
    const state = result.state;
    const usage = { ...(state.usage || {}) };
    const hasUsage = usage.prompt !== undefined || usage.completion !== undefined || usage.cost !== undefined;
    const hasOutput = Boolean(state.text || state.reasoning);

    if (!result.ok || (!hasUsage && !hasOutput)) {
        // Nothing was generated (error, rejected request, stop before the first token)
        awaitingMessage = awaitingMessage.filter(r => r !== record);
        if (record.inputCoin && record.inputCoin.usd > 0) {
            ui.launchCoin({ kind: 'refund', usd: record.inputCoin.usd, background: record.background });
        }
        return;
    }

    await catalogReady(4000);

    let estimated = false;
    if (usage.prompt === undefined) {
        usage.prompt = await estimatePromptTokens(record);
        estimated = true;
    }
    if (usage.completion === undefined) {
        usage.completion = await estimateTextTokens(state.text + state.reasoning);
        estimated = true;
    }

    const model = state.model || record.info.model || '?';
    const hasExactCost = typeof usage.cost === 'number';
    const price = lookupPrice(record.info.source, [state.model, record.info.model], hasExactCost);
    const cost = computeCost(usage, price);

    let accuracy = 'unknown';
    if (cost) accuracy = cost.exact ? 'exact' : (estimated ? 'estimated' : 'priced');

    const entry = {
        t: Date.now(),
        model,
        source: record.info.source,
        provider: state.provider || null,
        type: record.type,
        bg: record.background,
        tokIn: usage.prompt || 0,
        tokOut: usage.completion || 0,
        cacheRead: usage.cacheRead || 0,
        cacheWrite: usage.cacheWrite || 0,
        reasoning: usage.reasoning || 0,
        inUsd: cost ? cost.inUsd : null,
        outUsd: cost ? cost.outUsd : null,
        usd: cost ? cost.usd : null,
        accuracy,
        aborted: Boolean(result.aborted),
    };
    record.entry = entry;

    const billedSource = !FREE_OR_UNKNOWN_SOURCES.has(record.info.source) && !String(record.info.source).startsWith('tc:');
    const countIt = Boolean(cost) || billedSource || record.info.source === 'tc:openrouter';

    if (!countIt) {
        // Unpriced local / custom backend: nothing to show
        awaitingMessage = awaitingMessage.filter(r => r !== record);
        return;
    }

    recordStats(record, entry);
    launchResultCoins(record, entry, cost);
    applyToMessage(record);
    ui.update();
}

function recordStats(record, entry) {
    const s = settings();
    const stats = s.stats;
    stats.allTime = addToTotals(stats.allTime, entry);
    const key = dayKey();
    stats.days[key] = addToTotals(stats.days[key], entry);
    const days = Object.keys(stats.days).sort();
    while (days.length > DAYS_LIMIT) delete stats.days[days.shift()];
    stats.history.push(entry);
    if (stats.history.length > HISTORY_LIMIT) stats.history.splice(0, stats.history.length - HISTORY_LIMIT);
    save();

    // Per-chat totals live in the chat file itself
    if (record.chatId && record.chatId === currentChatId()) {
        const meta = ctx().chatMetadata;
        if (meta) {
            meta[META_KEY] = addToTotals(meta[META_KEY], entry);
            ctx().saveMetadataDebounced();
        }
    }
}

function launchResultCoins(record, entry, cost) {
    const common = { model: entry.model, background: record.background };

    if (!cost) {
        ui.launchCoin({ kind: 'input', usd: null, tokens: entry.tokIn, ...common });
        ui.launchCoin({ kind: 'output', usd: null, tokens: entry.tokOut, ...common });
        return;
    }

    const estimated = entry.accuracy === 'estimated';
    if (record.inputCoin) {
        // Input coin already flew on send: show the output and correct the input if needed
        const diff = Math.abs(cost.inUsd - record.inputCoin.usd);
        const shownAs = money(record.inputCoin.usd);
        const exactAs = money(cost.inUsd);
        const note = diff > cost.inUsd * 0.01 && shownAs !== exactAs ? t('input_corrected', { amount: exactAs }) : undefined;
        ui.launchCoin({ kind: 'output', usd: cost.outUsd, tokens: entry.tokOut, estimated, note, ...common });
        return;
    }

    ui.launchCoin({ kind: 'input', usd: cost.inUsd, tokens: entry.tokIn, estimated, ...common });
    ui.launchCoin({ kind: 'output', usd: cost.outUsd, tokens: entry.tokOut, estimated, ...common });
}

/* ------------------------------------------------------------- embeddings */

/** Exact token count of texts with OpenAI's cl100k tokenizer (used by text-embedding-3 / ada-002) */
async function countEmbeddingTokens(texts) {
    try {
        const response = await fetch('/api/tokenizers/openai/count?model=gpt-4', {
            method: 'POST',
            headers: ctx().getRequestHeaders(),
            body: JSON.stringify(texts.map(text => ({ content: text }))),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        const count = Number(json?.token_count);
        if (!Number.isFinite(count)) throw new Error('Bad token count');
        return { tokens: stripMessageOverhead(count, texts.length), exact: true };
    } catch {
        return { tokens: texts.reduce((sum, text) => sum + guessTokens(text), 0), exact: false };
    }
}

/** Adds one Vector Storage request to the current batch */
async function addEmbedding(record) {
    const { texts } = record.info.embedding;
    const [counted] = await Promise.all([countEmbeddingTokens(texts), catalogReady(3000)]);
    const model = record.info.model || '?';
    const key = `${record.info.source}|${model}|${record.chatId}`;

    if (embeddingBatch && embeddingBatch.key !== key) flushEmbeddings();
    if (!embeddingBatch) {
        embeddingBatch = { key, record, model, tokens: 0, exact: true, requests: 0, timer: null };
    }
    embeddingBatch.tokens += counted.tokens;
    embeddingBatch.exact = embeddingBatch.exact && counted.exact && isOpenAiEmbeddingModel(model);
    embeddingBatch.requests += 1;
    clearTimeout(embeddingBatch.timer);
    embeddingBatch.timer = setTimeout(flushEmbeddings, EMBEDDING_BATCH_DELAY);
}

function flushEmbeddings() {
    const batch = embeddingBatch;
    embeddingBatch = null;
    if (!batch) return;
    clearTimeout(batch.timer);

    const price = lookupPrice(batch.record.info.source, [batch.model]);
    const usd = price ? batch.tokens * price.p + (price.rq || 0) * batch.requests : null;
    const entry = {
        t: Date.now(),
        model: batch.model,
        source: batch.record.info.source,
        provider: null,
        type: 'embedding',
        bg: true,
        tokIn: batch.tokens,
        tokOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        inUsd: usd,
        outUsd: usd === null ? null : 0,
        usd,
        accuracy: usd === null ? 'unknown' : (batch.exact ? 'priced' : 'estimated'),
        aborted: false,
    };
    recordStats(batch.record, entry);
    // Vector Storage also re-syncs the chat on edits, deletions and swipes: counted silently unless asked for
    if (settings().embeddingCoins) {
        ui.launchCoin({
            kind: 'embedding',
            usd,
            tokens: batch.tokens,
            model: batch.model,
            estimated: entry.accuracy === 'estimated',
        });
    }
    ui.update();
}

/* ------------------------------------------------- per-message cost data */

function aggregateForMessage(previous, entry) {
    const base = previous && typeof previous === 'object' ? { ...previous } : { usd: null, inUsd: null, outUsd: null, tokIn: 0, tokOut: 0, n: 0 };
    const priced = entry.usd !== null && entry.usd !== undefined;
    const add = (a, b) => (a === null || a === undefined ? b : a + b);
    return {
        usd: priced ? add(base.usd, entry.usd) : base.usd,
        inUsd: priced ? add(base.inUsd, entry.inUsd) : base.inUsd,
        outUsd: priced ? add(base.outUsd, entry.outUsd) : base.outUsd,
        tokIn: (base.tokIn || 0) + entry.tokIn,
        tokOut: (base.tokOut || 0) + entry.tokOut,
        n: (base.n || 0) + 1,
        model: entry.model,
        source: entry.source,
        accuracy: worstAccuracy(base.accuracy, entry.accuracy),
    };
}

function worstAccuracy(a, b) {
    const order = ['exact', 'priced', 'estimated', 'unknown'];
    if (!a) return b;
    return order[Math.max(order.indexOf(a), order.indexOf(b))] || b;
}

/** Stores the cost inside the message (and its swipe), so it survives reloads */
function applyToMessage(record) {
    if (record.applied || !record.entry || record.mesId === null) return;
    const c = ctx();
    if (record.chatId !== currentChatId()) return;
    const message = c.chat?.[record.mesId];
    if (!message || message.is_user) return;

    record.applied = true;
    awaitingMessage = awaitingMessage.filter(r => r !== record);

    const isContinue = record.type === 'continue';
    const write = (holder) => {
        if (!holder || typeof holder !== 'object') return;
        if (!holder.extra || typeof holder.extra !== 'object') holder.extra = {};
        const previous = isContinue ? holder.extra[EXTRA_KEY] : null;
        holder.extra[EXTRA_KEY] = aggregateForMessage(previous, record.entry);
    };

    if ((message.swipe_id ?? 0) === record.swipeId) write(message);
    if (Array.isArray(message.swipe_info)) write(message.swipe_info[record.swipeId]);

    renderBadge(record.mesId);
    c.saveMetadataDebounced();
}

function onMessageReceived(mesId, type) {
    if (type === 'first_message' || type === 'command' || type === 'extension') return;
    const id = Number(mesId);
    const message = ctx().chat?.[id];
    if (!message || message.is_user) return;
    const chatId = currentChatId();
    const now = Date.now();
    // The newest generation of this chat that is still waiting for its message
    const record = [...awaitingMessage].reverse().find(r => r.mesId === null && r.chatId === chatId && now - r.t0 < 30 * 60 * 1000);
    if (!record) return;
    record.mesId = id;
    record.swipeId = message.swipe_id ?? 0;
    // Older unbound records will never get a message
    awaitingMessage = awaitingMessage.filter(r => r === record || r.t0 > record.t0);
    applyToMessage(record);
}

function renderBadge(mesId) {
    const message = ctx().chat?.[mesId];
    ui.renderMessageBadge(mesId, message && !message.is_user ? message.extra?.[EXTRA_KEY] : null);
}

function renderAllBadges() {
    const chat = ctx().chat || [];
    document.querySelectorAll('#chat .mes[mesid]').forEach((node) => {
        const id = Number(node.getAttribute('mesid'));
        if (Number.isInteger(id) && id >= 0 && id < chat.length) renderBadge(id);
    });
}

/* ---------------------------------------------------------------- actions */

async function confirmAction(text) {
    const c = ctx();
    try {
        if (typeof c.callGenericPopup === 'function' && c.POPUP_TYPE) {
            const result = await c.callGenericPopup(text, c.POPUP_TYPE.CONFIRM);
            return result === (c.POPUP_RESULT?.AFFIRMATIVE ?? 1);
        }
    } catch {
        // fall back to the browser dialog
    }
    return window.confirm(text);
}

function refreshAll({ keepSettings = false } = {}) {
    const s = settings();
    setLang(s.lang);
    if (!keepSettings) settingsPanel.render();
    ui.update();
    renderAllBadges();
}

async function resetChatStats() {
    if (!currentChatId()) {
        toastr.info(t('no_chat'));
        return;
    }
    if (!await confirmAction(t('confirm_reset_chat'))) return;
    const meta = ctx().chatMetadata;
    if (meta) {
        delete meta[META_KEY];
        ctx().saveMetadataDebounced();
    }
    ui.update();
}

async function resetAllStats() {
    if (!await confirmAction(t('confirm_reset_all'))) return;
    settings().stats = { allTime: emptyTotals(), days: {}, history: [] };
    const meta = ctx().chatMetadata;
    if (meta && meta[META_KEY]) {
        delete meta[META_KEY];
        ctx().saveMetadataDebounced();
    }
    save();
    ui.update();
}

function testAnimation() {
    const model = t('test_model');
    const inUsd = 0.0042 + Math.random() * 0.002;
    const outUsd = 0.011 + Math.random() * 0.004;
    ui.launchCoin({ kind: 'input', usd: inUsd, tokens: 12840, model });
    ui.launchCoin({ kind: 'output', usd: outUsd, tokens: 734, model });
}

/* ------------------------------------------------------------------- init */

installFetchInterceptor({
    isEnabled,
    onStart: info => onRequestStart(info),
    onFinish: (record, result) => { onRequestFinish(record, result); },
});

function init() {
    const c = ctx();
    const s = settings();
    setLang(s.lang);
    loadCatalogFromStorage();

    ui.mount();
    if (!settingsPanel.mount()) {
        // Extensions panel is not in the DOM yet
        setTimeout(() => settingsPanel.mount(), 1500);
    }

    const events = c.eventTypes || c.event_types;
    const on = (name, handler) => {
        if (name) c.eventSource.on(name, (...args) => {
            try {
                handler(...args);
            } catch (error) {
                console.warn(LOG, error);
            }
        });
    };

    on(events.MESSAGE_RECEIVED, onMessageReceived);
    on(events.CHARACTER_MESSAGE_RENDERED, (mesId) => renderBadge(Number(mesId)));
    on(events.MESSAGE_SWIPED, (mesId) => setTimeout(() => renderBadge(Number(mesId)), 0));
    on(events.MESSAGE_UPDATED, (mesId) => renderBadge(Number(mesId)));
    on(events.MORE_MESSAGES_LOADED, () => renderAllBadges());
    on(events.CHAT_CHANGED, () => {
        awaitingMessage = [];
        ui.update();
        setTimeout(renderAllBadges, 0);
    });
    on(events.GENERATION_STARTED, (type, _options, dryRun) => {
        if (!dryRun) activeGeneration = { type: type || 'normal', t: Date.now() };
    });
    on(events.GENERATION_ENDED, () => { activeGeneration = null; });
    on(events.GENERATION_STOPPED, () => { activeGeneration = null; });
    on(events.SETTINGS_UPDATED, () => ui.update());

    refreshCatalog().catch(() => { });
    refreshRate().catch(() => { });
    setInterval(() => {
        refreshRate().catch(() => { });
        refreshCatalog().catch(() => { });
    }, 60 * 60 * 1000);

    renderAllBadges();
    console.info(LOG, 'loaded');
}

try {
    init();
} catch (error) {
    console.error(LOG, 'Initialization failed', error);
}
