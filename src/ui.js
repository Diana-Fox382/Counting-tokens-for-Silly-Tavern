/**
 * On-screen wallet, flying coins, statistics panel and per-message cost badges.
 */

import { t, getLocale } from './i18n.js';
import { formatTokens, formatTokensFull, currencySymbol } from './currency.js';
import { getWallet, renderWallet } from './wallets.js';

const COIN_DURATION = 2700;
const COIN_SPACING = 650;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
}

/** Removes the vendor prefix: google/gemini-2.5-pro -> gemini-2.5-pro */
export function shortModel(model) {
    const s = String(model || '?').replace(/^models\//, '');
    const short = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
    return short.length > 34 ? `${short.slice(0, 32)}…` : short;
}

/**
 * @typedef {object} UiHost
 * @property {() => any} settings
 * @property {() => void} save
 * @property {(usd: number, opts?: {minus?: boolean}) => string} money
 * @property {() => number} rate
 * @property {() => boolean} rateIsFallback True when no real exchange rate is available
 * @property {() => any} chatTotals Totals of the current chat or null
 * @property {() => any} todayTotals
 * @property {() => any} allTotals
 * @property {() => any[]} history
 * @property {() => void} openSettings
 * @property {() => void} refreshAll Re-render everything after a settings change
 * @property {() => string} version Extension version from manifest.json
 */

export class WalletUI {
    /** @param {UiHost} host */
    constructor(host) {
        this.host = host;
        this.root = null;
        this.layer = null;
        this.panel = null;
        this.nextLaunchAt = 0;
        this.busy = false;
        this.onResize = () => this.applyPosition();
    }

    mount() {
        if (this.root) return;
        this.layer = el('div', 'tw-coin-layer');
        document.body.appendChild(this.layer);

        this.root = el('div', 'tw-wallet');
        // Not a <button>: SillyTavern themes restyle every button on the page (background, border, shadow)
        this.button = el('div', 'tw-wallet-button');
        this.button.setAttribute('role', 'button');
        this.button.tabIndex = 0;
        this.renderedWallet = null;
        this.total = el('div', 'tw-wallet-total');
        this.root.append(this.button, this.total);
        document.body.appendChild(this.root);

        this.bindDrag();
        window.addEventListener('resize', this.onResize);
        this.update();
    }

    /* ---------------------------------------------------------------- wallet */

    update() {
        if (!this.root) return;
        const s = this.host.settings();
        const visible = s.enabled && s.showWallet;
        this.root.classList.toggle('tw-hidden', !visible);
        if (this.renderedWallet !== s.wallet) {
            this.button.innerHTML = renderWallet(s.wallet, 'tw-wallet');
            this.renderedWallet = s.wallet;
        }
        this.root.style.setProperty('--tw-glow', getWallet(s.wallet).glow);
        this.root.dataset.size = s.size;
        this.root.classList.toggle('tw-shine', Boolean(s.shine));
        this.root.classList.toggle('tw-busy', this.busy);
        this.button.title = t('wallet_title');
        this.button.setAttribute('aria-label', t('title'));

        const totals = this.host.chatTotals();
        if (s.showChatTotal && totals && (totals.count > 0)) {
            this.total.textContent = totals.usd > 0 || totals.unpriced === 0
                ? this.host.money(totals.usd)
                : `${formatTokens(totals.tokIn + totals.tokOut)} ${t('tok')}`;
            this.total.title = `${t('this_chat')}: ${t('requests_n', { n: totals.count })}`;
            this.total.classList.remove('tw-hidden');
        } else {
            this.total.classList.add('tw-hidden');
        }

        this.applyPosition();
        if (this.panel) this.renderPanel();
    }

    setBusy(busy) {
        this.busy = Boolean(busy);
        this.root?.classList.toggle('tw-busy', this.busy);
    }

    /**
     * Always positions with left/top in pixels. SillyTavern's mobile layout puts a transform on <html>
     * (whose height is 0), so `bottom`/`right` anchoring of fixed elements would push them off screen.
     */
    applyPosition() {
        if (!this.root) return;
        const pos = this.host.settings().position;
        const w = this.button.offsetWidth || 54;
        const h = this.button.offsetHeight || 54;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const maxX = Math.max(0, vw - w);
        const maxY = Math.max(0, vh - h - 18);
        let left;
        let top;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            left = Math.min(1, Math.max(0, pos.x)) * maxX;
            top = Math.min(1, Math.max(0, pos.y)) * maxY;
        } else {
            const mobile = vw <= 1000;
            left = vw - w - (mobile ? 10 : 18);
            top = vh - h - (mobile ? 110 : 140);
        }
        this.root.style.left = `${Math.round(Math.min(maxX, Math.max(0, left)))}px`;
        this.root.style.top = `${Math.round(Math.min(maxY, Math.max(0, top)))}px`;
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
    }

    resetPosition() {
        this.host.settings().position = null;
        this.host.save();
        this.applyPosition();
    }

    bindDrag() {
        let start = null;
        let moved = false;

        this.button.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const rect = this.root.getBoundingClientRect();
            start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
            moved = false;
            try {
                this.button.setPointerCapture(event.pointerId);
            } catch {
                // ignore
            }
        });

        this.button.addEventListener('pointermove', (event) => {
            if (!start || event.pointerId !== start.id) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (!moved && Math.hypot(dx, dy) < 6) return;
            if (!moved) {
                moved = true;
                this.root.classList.add('tw-dragging');
                this.closePanel();
            }
            const rect = this.button.getBoundingClientRect();
            const left = Math.min(window.innerWidth - rect.width, Math.max(0, start.left + dx));
            const top = Math.min(window.innerHeight - rect.height - 18, Math.max(0, start.top + dy));
            this.root.style.left = `${left}px`;
            this.root.style.top = `${top}px`;
            this.root.style.right = 'auto';
            this.root.style.bottom = 'auto';
        });

        const finish = (event) => {
            if (!start || event.pointerId !== start.id) return;
            start = null;
            this.root.classList.remove('tw-dragging');
            if (moved) {
                const rect = this.button.getBoundingClientRect();
                const maxX = Math.max(1, window.innerWidth - rect.width);
                const maxY = Math.max(1, window.innerHeight - rect.height - 18);
                this.host.settings().position = {
                    x: Math.min(1, Math.max(0, rect.left / maxX)),
                    y: Math.min(1, Math.max(0, rect.top / maxY)),
                };
                this.host.save();
            } else if (event.type === 'pointerup') {
                this.togglePanel();
            }
        };
        this.button.addEventListener('pointerup', finish);
        this.button.addEventListener('pointercancel', finish);
        this.button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this.togglePanel();
            }
        });
    }

    /** Origin point of coins: the wallet mouth */
    origin() {
        const s = this.host.settings();
        if (this.root && s.enabled && s.showWallet && !this.root.classList.contains('tw-hidden')) {
            const rect = this.button.getBoundingClientRect();
            if (rect.width > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.3, rect };
            }
        }
        return null;
    }

    pulseWallet(className = 'tw-pop') {
        if (!this.root) return;
        this.root.classList.remove(className);
        void this.root.offsetWidth; // restart animation
        this.root.classList.add(className);
        setTimeout(() => this.root?.classList.remove(className), 700);
    }

    /* ----------------------------------------------------------------- coins */

    /**
     * @param {object} coin
     * @param {'input'|'output'|'refund'|'embedding'} coin.kind
     * @param {number|null} coin.usd Amount (null when the price is unknown)
     * @param {number} [coin.tokens]
     * @param {string} [coin.model]
     * @param {boolean} [coin.estimated]
     * @param {boolean} [coin.background]
     * @param {string} [coin.note] Second caption line
     * @param {string} [coin.label] Caption instead of "input"/"output" (e.g. "embeddings")
     * @param {string} [coin.via] Extension that sent a background request
     */
    launchCoin(coin) {
        const now = performance.now();
        const at = Math.max(now, this.nextLaunchAt);
        this.nextLaunchAt = at + COIN_SPACING;
        setTimeout(() => this.spawnCoin(coin), at - now);
    }

    spawnCoin(coin) {
        const origin = this.origin();
        if (!origin || !this.layer) return;
        const s = this.host.settings();
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

        const fly = el('div', `tw-fly tw-fly--${coin.kind}${coin.background ? ' tw-fly--bg' : ''}`);
        const coinEl = el('div', 'tw-coin');
        const face = el('div', 'tw-coin-face', currencySymbol(s.currency));
        coinEl.appendChild(face);

        const label = el('div', 'tw-coin-label');
        const amount = el('div', 'tw-coin-amount');
        if (coin.usd === null || coin.usd === undefined) {
            amount.textContent = `${formatTokens(coin.tokens)} ${t('tok')}`;
        } else if (coin.usd === 0 && coin.kind !== 'refund') {
            amount.textContent = t('free');
        } else {
            const text = coin.kind === 'refund'
                ? `+${this.host.money(coin.usd)}`
                : this.host.money(coin.usd, { minus: true });
            amount.textContent = coin.estimated ? `≈ ${text}` : text;
        }
        label.appendChild(amount);

        const caption = [];
        const kindLabel = { input: t('coin_input'), output: t('coin_output'), refund: t('refund'), embedding: t('coin_embedding') }[coin.kind];
        caption.push(coin.label || kindLabel);
        if (coin.kind !== 'refund' && coin.tokens !== undefined && coin.usd !== null && coin.usd !== undefined) {
            caption.push(`${formatTokens(coin.tokens)} ${t('tok')}`);
        }
        if (coin.usd === null || coin.usd === undefined) caption.push(t('no_price'));
        if (coin.background && !coin.label) caption.push(coin.via ? `${t('bg')}: ${coin.via}` : t('bg'));
        if (s.showModelOnCoin && coin.model) caption.push(shortModel(coin.model));
        label.appendChild(el('div', 'tw-coin-caption', caption.join(' · ')));
        if (coin.note) label.appendChild(el('div', 'tw-coin-note', coin.note));
        if (coin.usd === null || coin.usd === undefined) label.title = t('no_price_hint');

        const leftSide = origin.x > window.innerWidth / 2;
        fly.classList.add(leftSide ? 'tw-label-left' : 'tw-label-right');
        fly.append(coinEl, label);
        fly.style.left = `${origin.x}px`;
        fly.style.top = `${origin.y}px`;
        this.layer.appendChild(fly);

        const up = origin.rect.top > 190 ? -1 : 1;
        // Input coins fly higher and further than output coins, so two coins in a row do not overlap
        const isInput = coin.kind === 'input';
        const isEmbedding = coin.kind === 'embedding';
        const drift = (leftSide ? -1 : 1) * (isInput ? 34 + Math.random() * 18 : isEmbedding ? 22 + Math.random() * 10 : 8 + Math.random() * 14);
        const rise = isInput ? 172 + Math.random() * 14 : isEmbedding ? 118 + Math.random() * 12 : 138 + Math.random() * 14;

        let keyframes;
        if (coin.kind === 'refund') {
            keyframes = [
                { transform: `translate(${drift}px, ${up * rise * 0.8}px) scale(.9)`, opacity: 0, filter: 'blur(3px)' },
                { transform: `translate(${drift * 0.6}px, ${up * rise * 0.55}px) scale(1)`, opacity: 1, filter: 'blur(0px)', offset: 0.3 },
                { transform: `translate(${drift * 0.2}px, ${up * 30}px) scale(1)`, opacity: 1, filter: 'blur(0px)', offset: 0.75 },
                { transform: 'translate(0px, 6px) scale(.35)', opacity: 0, filter: 'blur(0px)' },
            ];
        } else {
            keyframes = [
                { transform: 'translate(0px, 8px) scale(.3)', opacity: 0, filter: 'blur(0px)' },
                { transform: `translate(${drift * 0.15}px, ${up * 42}px) scale(1.12)`, opacity: 1, filter: 'blur(0px)', offset: 0.16 },
                { transform: `translate(${drift * 0.45}px, ${up * rise * 0.6}px) scale(1)`, opacity: 1, filter: 'blur(0px)', offset: 0.55 },
                { transform: `translate(${drift * 0.8}px, ${up * rise * 0.88}px) scale(.98)`, opacity: 0.85, filter: 'blur(0.5px)', offset: 0.8 },
                { transform: `translate(${drift}px, ${up * rise}px) scale(.9)`, opacity: 0, filter: 'blur(4px)' },
            ];
        }

        const duration = reduceMotion ? 1600 : COIN_DURATION;
        if (coin.kind !== 'refund') this.pulseWallet('tw-pop');

        const animation = fly.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.75,.3,1)', fill: 'forwards' });
        animation.onfinish = () => fly.remove();
        animation.oncancel = () => fly.remove();

        if (!reduceMotion) {
            if (coin.kind === 'refund') {
                setTimeout(() => this.pulseWallet('tw-pop'), duration * 0.9);
            } else {
                setTimeout(() => this.sparkle(origin.x + drift * 0.85, origin.y + up * rise * 0.9, coin.kind), duration * 0.72);
            }
        }
    }

    /** Small golden dust where the coin dissolves */
    sparkle(x, y, kind) {
        if (!this.layer) return;
        const count = 9;
        for (let i = 0; i < count; i++) {
            const dot = el('div', `tw-spark tw-spark--${kind}`);
            dot.style.left = `${x}px`;
            dot.style.top = `${y}px`;
            this.layer.appendChild(dot);
            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
            const dist = 16 + Math.random() * 22;
            const anim = dot.animate([
                { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95 },
                { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 10}px)) scale(.2)`, opacity: 0 },
            ], { duration: 650 + Math.random() * 350, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
            anim.onfinish = () => dot.remove();
        }
    }

    /* ----------------------------------------------------------------- panel */

    togglePanel() {
        if (this.panel) this.closePanel();
        else this.openPanel();
    }

    openPanel() {
        if (this.panel) return;
        this.panel = el('div', 'tw-panel');
        this.panel.setAttribute('role', 'dialog');
        document.body.appendChild(this.panel);
        this.renderPanel();

        this.outsideHandler = (event) => {
            if (!this.panel) return;
            if (this.panel.contains(event.target) || this.root.contains(event.target)) return;
            this.closePanel();
        };
        this.keyHandler = (event) => {
            if (event.key === 'Escape') this.closePanel();
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        }, 0);
    }

    closePanel() {
        if (!this.panel) return;
        this.panel.remove();
        this.panel = null;
        document.removeEventListener('pointerdown', this.outsideHandler, true);
        document.removeEventListener('keydown', this.keyHandler);
    }

    positionPanel() {
        if (!this.panel) return;
        const margin = 10;
        const rect = this.button.getBoundingClientRect();
        const pw = this.panel.offsetWidth;
        const ph = this.panel.offsetHeight;
        let left = rect.left + rect.width / 2 > window.innerWidth / 2 ? rect.right - pw : rect.left;
        let top = rect.top - ph - margin;
        if (top < margin) top = rect.bottom + margin + 16;
        if (top + ph > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - ph - margin);
        left = Math.min(window.innerWidth - pw - margin, Math.max(margin, left));
        this.panel.style.left = `${left}px`;
        this.panel.style.top = `${top}px`;
    }

    totalsRow(label, totals) {
        if (!totals) {
            return `<div class="tw-row"><span>${escapeHtml(label)}</span><span class="tw-dim">—</span></div>`;
        }
        const money = totals.count && (totals.usd > 0 || !totals.unpriced) ? this.host.money(totals.usd) : '—';
        return `<div class="tw-row">
            <span>${escapeHtml(label)}</span>
            <span><b>${escapeHtml(money)}</b> <span class="tw-dim">· ${escapeHtml(t('requests_n', { n: totals.count || 0 }))}</span></span>
        </div>`;
    }

    renderPanel() {
        if (!this.panel) return;
        const s = this.host.settings();
        const history = this.host.history();
        // Embeddings follow every reply and failed requests cost nothing: the block shows the last billed reply
        const last = [...history].reverse().find(item => item.type !== 'embedding' && !item.failed)
            || [...history].reverse().find(item => !item.failed);
        const money = (usd) => (usd === null || usd === undefined ? '—' : this.host.money(usd));

        let lastHtml = `<div class="tw-empty">${escapeHtml(t('no_requests'))}</div>`;
        if (last) {
            const accuracy = accuracyText(last);
            const extras = [];
            if (last.cacheRead) extras.push(`${formatTokensFull(last.cacheRead)} ${t('cached')}`);
            if (last.cacheWrite) extras.push(`${formatTokensFull(last.cacheWrite)} ${t('cache_write')}`);
            const outExtras = last.reasoning ? `<div class="tw-sub">${escapeHtml(formatTokensFull(last.reasoning))} ${escapeHtml(t('reasoning'))}</div>` : '';
            lastHtml = `
                <div class="tw-model" title="${escapeHtml(last.model)}">${escapeHtml(last.model)}</div>
                <div class="tw-dim tw-small">${escapeHtml([last.provider, typeLabel(last), formatTime(last.t)].filter(Boolean).join(' · '))}${last.aborted ? ` · ${escapeHtml(t('aborted'))}` : ''}</div>
                <div class="tw-grid">
                    <span>${escapeHtml(t('input'))}</span>
                    <span class="tw-num">${escapeHtml(formatTokensFull(last.tokIn))} ${escapeHtml(t('tok'))}${extras.length ? `<div class="tw-sub">${escapeHtml(extras.join(', '))}</div>` : ''}</span>
                    <span class="tw-num tw-money">${escapeHtml(money(last.inUsd))}</span>
                    <span>${escapeHtml(t('output'))}</span>
                    <span class="tw-num">${escapeHtml(formatTokensFull(last.tokOut))} ${escapeHtml(t('tok'))}${outExtras}</span>
                    <span class="tw-num tw-money">${escapeHtml(money(last.outUsd))}</span>
                    <span class="tw-total-label">${escapeHtml(t('total'))}</span>
                    <span></span>
                    <span class="tw-num tw-money tw-total-value">${escapeHtml(money(last.usd))}</span>
                </div>
                <div class="tw-accuracy tw-accuracy--${escapeHtml(last.accuracy)}">${last.accuracy === 'exact' ? '✓' : last.accuracy === 'unknown' ? '?' : '≈'} ${escapeHtml(accuracy)}</div>`;
        }

        // Embeddings come in series (every edit/swipe re-syncs Vector Storage): consecutive ones share a row
        const rows = [];
        for (const item of [...history].reverse()) {
            const previous = rows[rows.length - 1];
            if (previous && item.type === 'embedding' && previous.type === 'embedding' && previous.model === item.model) {
                previous.count += 1;
                previous.tokIn += item.tokIn || 0;
                previous.usd = previous.usd === null || item.usd === null ? null : previous.usd + item.usd;
                previous.inUsd = previous.usd;
                continue;
            }
            if (rows.length >= 12) break;
            rows.push({ ...item, count: 1 });
        }

        const historyHtml = rows.map((item) => {
            const tags = [];
            if (item.type === 'embedding') tags.push(item.count > 1 ? `${t('tag_embedding')} ×${item.count}` : t('tag_embedding'));
            else if (item.bg) tags.push(item.via ? shortTag(item.via) : t('bg'));
            const source = item.via ? `\n${t('sent_by')}: ${item.via}` : '';
            const tooltip = item.failed
                ? `${item.model}\n${typeLabel(item)}${source}\n${t('failed_hint')}\n${t('error')}: ${item.reason || '?'}\n${t('server_log_hint')}`
                : `${item.model}${source}\n${t('input')}: ${formatTokensFull(item.tokIn)} ${t('tok')} — ${money(item.inUsd)}\n${t('output')}: ${formatTokensFull(item.tokOut)} ${t('tok')} — ${money(item.outUsd)}`;
            return `
            <div class="tw-hist${item.failed ? ' tw-hist--failed' : ''}" title="${escapeHtml(tooltip)}">
                <span class="tw-dim">${escapeHtml(formatTime(item.t))}</span>
                <span class="tw-hist-model">${escapeHtml(shortModel(item.model))}${tags.map(tag => ` <span class="tw-tag">${escapeHtml(tag)}</span>`).join('')}</span>
                <span class="tw-num">${item.failed ? escapeHtml(t('tag_failed')) : `${item.accuracy === 'estimated' ? '≈' : ''}${escapeHtml(money(item.usd))}`}</span>
            </div>`;
        }).join('');

        const rateText = t('rate_line', { rate: this.host.rate().toLocaleString(getLocale(), { maximumFractionDigits: 2 }) });
        const rateLine = s.currency === 'RUB'
            ? `<div class="tw-dim tw-small">${escapeHtml(this.host.rateIsFallback() ? `${rateText} (${t('rate_fallback')})` : rateText)}</div>`
            : '';

        this.panel.innerHTML = `
            <div class="tw-panel-head">
                <div class="tw-panel-title">${renderWallet(s.wallet, 'tw-panel')}<span>${escapeHtml(t('panel_title'))}</span></div>
                <div class="tw-currency-switch" role="group">
                    <span role="button" tabindex="0" data-currency="RUB" class="tw-cur${s.currency === 'RUB' ? ' tw-active' : ''}">₽</span>
                    <span role="button" tabindex="0" data-currency="USD" class="tw-cur${s.currency === 'USD' ? ' tw-active' : ''}">$</span>
                </div>
                <span role="button" tabindex="0" class="tw-icon-btn tw-settings-btn" title="${escapeHtml(t('settings'))}"><i class="fa-solid fa-gear"></i></span>
                <span role="button" tabindex="0" class="tw-icon-btn tw-close-btn" title="${escapeHtml(t('close'))}"><i class="fa-solid fa-xmark"></i></span>
            </div>
            <div class="tw-section">
                <div class="tw-section-title">${escapeHtml(t('last_request'))}</div>
                ${lastHtml}
            </div>
            <div class="tw-section">
                ${this.totalsRow(t('this_chat'), this.host.chatTotals())}
                ${this.totalsRow(t('today'), this.host.todayTotals())}
                ${this.totalsRow(t('all_time'), this.host.allTotals())}
                ${rateLine}
            </div>
            ${historyHtml ? `<div class="tw-section"><div class="tw-section-title">${escapeHtml(t('history'))}</div><div class="tw-hist-list">${historyHtml}</div></div>` : ''}
            ${this.host.version() ? `<div class="tw-version tw-panel-version">v${escapeHtml(this.host.version())}</div>` : ''}
        `;

        this.panel.querySelectorAll('[data-currency]').forEach(button => {
            button.addEventListener('click', () => {
                this.host.settings().currency = button.getAttribute('data-currency');
                this.host.save();
                this.host.refreshAll();
            });
        });
        this.panel.querySelector('.tw-close-btn')?.addEventListener('click', () => this.closePanel());
        this.panel.querySelector('.tw-settings-btn')?.addEventListener('click', () => {
            this.closePanel();
            this.host.openSettings();
        });
        activateWithKeyboard(this.panel);
        this.positionPanel();
    }

    /* ----------------------------------------------------------- per message */

    /**
     * @param {number} mesId
     * @param {any} data Aggregated message cost
     */
    renderMessageBadge(mesId, data) {
        const mes = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
        if (!mes) return;
        let badge = mes.querySelector('.tw-mes-cost');
        const s = this.host.settings();
        if (!s.enabled || !s.showMessageCost || !data) {
            badge?.remove();
            return;
        }
        if (!badge) {
            // At the end of the name/timestamp row: does not change the width of the avatar column.
            // Not directly after .timestamp: SillyTavern expects its model icon there.
            badge = el('small', 'tw-mes-cost');
            const header = mes.querySelector('.ch_name .alignItemsBaseline') || mes.querySelector('.ch_name') || mes;
            header.appendChild(badge);
        }
        const hasMoney = data.usd !== null && data.usd !== undefined;
        badge.textContent = hasMoney
            ? `${data.accuracy === 'estimated' ? '≈' : ''}${this.host.money(data.usd)}`
            : `${formatTokens((data.tokIn || 0) + (data.tokOut || 0))} ${t('tok')}`;
        const lines = [
            t('message_cost'),
            `${t('model')}: ${data.model || '?'}`,
            `${t('input')}: ${formatTokensFull(data.tokIn)} ${t('tok')}${hasMoney ? ` — ${this.host.money(data.inUsd)}` : ''}`,
            `${t('output')}: ${formatTokensFull(data.tokOut)} ${t('tok')}${hasMoney ? ` — ${this.host.money(data.outUsd)}` : ''}`,
        ];
        if (data.n > 1) lines.push(t('message_requests', { n: data.n }));
        lines.push(accuracyText(data));
        badge.title = lines.join('\n');
    }

    destroy() {
        this.closePanel();
        this.root?.remove();
        this.layer?.remove();
        window.removeEventListener('resize', this.onResize);
        this.root = null;
        this.layer = null;
    }
}

/** Human readable accuracy of a cost record */
function accuracyText(entry) {
    switch (entry?.accuracy) {
        case 'exact': return String(entry.source || '').endsWith('openrouter') ? t('exact') : t('exact_provider');
        case 'priced': return t('priced');
        case 'estimated': return t('estimated');
        default: return t('no_price_hint');
    }
}

/**
 * Enter / Space on elements with role="button" act as a click (they are not real buttons, see above).
 * @param {HTMLElement} root
 */
export function activateWithKeyboard(root) {
    root.querySelectorAll('[role="button"], [role="radio"]').forEach((node) => {
        node.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                /** @type {HTMLElement} */ (node).click();
            }
        });
    });
}

/** Extension name for a small history tag */
function shortTag(name) {
    const last = String(name).split(' → ')[0];
    return last.length > 20 ? `${last.slice(0, 19)}…` : last;
}

function typeLabel(entry) {
    if (entry.type === 'embedding') return t('type_embedding');
    if (entry.bg) return t('type_background');
    const key = `type_${entry.type}`;
    const label = t(key);
    return label === key ? '' : label;
}

function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}
