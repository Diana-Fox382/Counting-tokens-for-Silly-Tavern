/**
 * Model prices.
 *
 * Main source is the public OpenRouter model catalog (https://openrouter.ai/api/v1/models).
 * It is also used as a price reference for direct providers (Google AI Studio, Anthropic,
 * OpenAI, DeepSeek...), because OpenRouter passes provider prices through unchanged.
 * Users can override any price in the settings.
 *
 * All prices are stored in USD per token.
 */

/**
 * @typedef {object} Price
 * @property {number} p Prompt (input) price per token
 * @property {number} c Completion (output) price per token
 * @property {number|null} [cr] Cache read price per token
 * @property {number|null} [cw] Cache write price per token
 * @property {number} [rq] Fixed price per request
 * @property {string} [id] Catalog id the price was taken from
 * @property {string} [origin] 'catalog' | 'custom'
 */

/**
 * Vendor prefixes in the OpenRouter catalog for SillyTavern chat completion sources.
 */
const SOURCE_VENDORS = {
    claude: ['anthropic'],
    makersuite: ['google'],
    vertexai: ['google'],
    openai: ['openai'],
    azure_openai: ['openai'],
    deepseek: ['deepseek'],
    mistralai: ['mistralai'],
    xai: ['x-ai'],
    cohere: ['cohere'],
    ai21: ['ai21'],
    perplexity: ['perplexity'],
    moonshot: ['moonshotai'],
    zai: ['z-ai'],
    minimax: ['minimax'],
};

function toPrice(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Compacts a catalog entry from the OpenRouter `/models` response.
 * @param {any} model
 * @returns {Price|null}
 */
export function compactCatalogModel(model) {
    const pricing = model?.pricing;
    if (!pricing) return null;
    const p = toPrice(pricing.prompt);
    const c = toPrice(pricing.completion);
    if (p === null || c === null) return null; // e.g. openrouter/auto has -1
    /** @type {Price} */
    const price = { p, c };
    const cr = toPrice(pricing.input_cache_read);
    const cw = toPrice(pricing.input_cache_write);
    const rq = toPrice(pricing.request);
    if (cr !== null) price.cr = cr;
    if (cw !== null) price.cw = cw;
    if (rq) price.rq = rq;
    return price;
}

/**
 * Normalizes a model id for fuzzy comparison between providers:
 * `anthropic/claude-3.5-sonnet` and `claude-3-5-sonnet` both become `claude-3-5-sonnet`.
 * @param {string} id
 */
export function normalizeModelKey(id) {
    return String(id ?? '')
        .toLowerCase()
        .trim()
        .replace(/^models\//, '')
        .replace(/^.*\//, '')
        .replace(/:.*$/, '')
        .replace(/[._\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

const SUFFIX_RULES = [
    /-\d{8}$/, // claude-...-20250514
    /-\d{4}-\d{2}-\d{2}$/, // gpt-4o-2024-08-06
    /-latest$/,
    /-(preview|exp)-\d{2}-\d{2}(-\d{2,4})?$/, // gemini-2.5-flash-preview-05-20
    /-(preview|exp|experimental)(-\d+)?$/,
    /-\d{3}$/, // gemini-2.0-flash-001
];

/**
 * Yields progressively simplified versions of a normalized key.
 * @param {string} key
 */
export function keyVariants(key) {
    const result = [key];
    let current = key;
    for (let guard = 0; guard < 8; guard++) {
        let changed = false;
        for (const rule of SUFFIX_RULES) {
            const next = current.replace(rule, '');
            if (next !== current && next.length > 2) {
                current = next;
                result.push(current);
                changed = true;
                break;
            }
        }
        if (!changed) break;
    }
    return result;
}

/**
 * Price catalog with exact and fuzzy lookup.
 */
export class PriceCatalog {
    /**
     * @param {Record<string, Price>} models Map of catalog id -> price
     */
    constructor(models = {}) {
        this.models = models;
        /** @type {Map<string, string[]>} */
        this.index = new Map();
        for (const id of Object.keys(models)) {
            if (id.includes(':')) continue; // :free, :beta... only by exact id
            const key = normalizeModelKey(id);
            if (!this.index.has(key)) this.index.set(key, []);
            this.index.get(key).push(id);
        }
    }

    get size() {
        return Object.keys(this.models).length;
    }

    /**
     * @param {string} source SillyTavern source (chat completion source or `tc:<api_type>`)
     * @param {string} model Model id as sent to / reported by the provider
     * @returns {Price|null}
     */
    find(source, model) {
        if (!model) return null;
        const raw = String(model).trim();
        const lower = raw.toLowerCase();

        if (this.models[raw]) return { ...this.models[raw], id: raw, origin: 'catalog' };
        if (this.models[lower]) return { ...this.models[lower], id: lower, origin: 'catalog' };

        const vendors = SOURCE_VENDORS[source] || [];
        for (const vendor of vendors) {
            const id = `${vendor}/${lower.replace(/^models\//, '')}`;
            if (this.models[id]) return { ...this.models[id], id, origin: 'catalog' };
        }

        const rawVendor = lower.includes('/') ? lower.split('/')[0] : null;
        for (const key of keyVariants(normalizeModelKey(raw))) {
            const ids = this.index.get(key);
            if (!ids?.length) continue;
            const preferred = ids.find(id => vendors.includes(id.split('/')[0]))
                || (rawVendor && ids.find(id => id.split('/')[0] === rawVendor))
                || ids[0];
            return { ...this.models[preferred], id: preferred, origin: 'catalog' };
        }
        return null;
    }
}

/**
 * @typedef {object} CustomPriceRule
 * @property {string} pattern
 * @property {RegExp|null} regex
 * @property {Price} price
 */

/**
 * Parses user price overrides. One rule per line, prices in USD per 1M tokens:
 *   gemini-2.5-pro = 1.25 / 10
 *   google/gemini-2.5-flash = 0.30 / 2.50 / 0.075   (third value: cache read)
 *   gemini-* = 0 / 0                               (free tier)
 * @param {string} text
 * @returns {CustomPriceRule[]}
 */
export function parseCustomPrices(text) {
    const rules = [];
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;
        const eq = line.lastIndexOf('=');
        if (eq <= 0) continue;
        const pattern = line.slice(0, eq).trim();
        const values = line.slice(eq + 1).split('/').map(v => Number(v.trim().replace(',', '.').replace(/[$\s]/g, '')));
        if (!pattern || values.length < 2 || values.slice(0, 2).some(v => !Number.isFinite(v) || v < 0)) continue;
        /** @type {Price} */
        const price = { p: values[0] / 1e6, c: values[1] / 1e6, origin: 'custom', id: pattern };
        if (values.length > 2 && Number.isFinite(values[2]) && values[2] >= 0) price.cr = values[2] / 1e6;
        const regex = pattern.includes('*')
            ? new RegExp('^' + pattern.toLowerCase().split('*').map(escapeRegex).join('.*') + '$')
            : null;
        rules.push({ pattern: pattern.toLowerCase(), regex, price });
    }
    return rules;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {CustomPriceRule[]} rules
 * @param {string} model
 * @returns {Price|null}
 */
export function findCustomPrice(rules, model) {
    if (!model || !rules?.length) return null;
    const lower = String(model).toLowerCase();
    const short = lower.replace(/^models\//, '').replace(/^.*\//, '');
    const key = normalizeModelKey(model);
    for (const rule of rules) {
        if (rule.regex) {
            if (rule.regex.test(lower) || rule.regex.test(short)) return { ...rule.price };
        } else if (rule.pattern === lower || rule.pattern === short || normalizeModelKey(rule.pattern) === key) {
            return { ...rule.price };
        }
    }
    return null;
}

/**
 * @typedef {object} CostResult
 * @property {number} inUsd
 * @property {number} outUsd
 * @property {number} usd
 * @property {boolean} exact True when the total comes from the provider bill (OpenRouter)
 */

/**
 * Calculates input/output cost.
 * When the provider reports the exact total (OpenRouter `usage.cost`), the total is kept exact and
 * only split between input and output proportionally to list prices.
 * @param {import('./usage.js').NormalizedUsage} usage
 * @param {Price|null} price
 * @returns {CostResult|null}
 */
export function computeCost(usage, price) {
    const prompt = Math.max(0, usage?.prompt || 0);
    const completion = Math.max(0, usage?.completion || 0);
    const cacheRead = Math.min(Math.max(0, usage?.cacheRead || 0), prompt);
    const cacheWrite = Math.min(Math.max(0, usage?.cacheWrite || 0), prompt - cacheRead);

    let listIn = null;
    let listOut = null;
    if (price) {
        listIn = (prompt - cacheRead - cacheWrite) * price.p
            + cacheRead * (price.cr ?? price.p)
            + cacheWrite * (price.cw ?? price.p)
            + (price.rq || 0);
        listOut = completion * price.c;
    }

    if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) {
        const total = Math.max(0, usage.cost);
        let inShare;
        if (usage.costIn !== undefined && usage.costOut !== undefined && usage.costIn + usage.costOut > 0) {
            inShare = usage.costIn / (usage.costIn + usage.costOut);
        } else if (listIn !== null && listIn + listOut > 0) {
            inShare = listIn / (listIn + listOut);
        } else if (prompt + completion > 0) {
            // No price list: assume output is ~4x more expensive than input (typical for most models)
            inShare = prompt / (prompt + 4 * completion);
        } else {
            inShare = 0.5;
        }
        const inUsd = total * inShare;
        return { inUsd, outUsd: total - inUsd, usd: total, exact: true };
    }

    if (listIn === null) return null;
    return { inUsd: listIn, outUsd: listOut, usd: listIn + listOut, exact: false };
}

/**
 * Pricing for an input estimate made before the response arrives.
 * @param {number} tokens
 * @param {Price|null} price
 */
export function estimateInputCost(tokens, price) {
    if (!price) return null;
    return Math.max(0, tokens) * price.p + (price.rq || 0);
}
