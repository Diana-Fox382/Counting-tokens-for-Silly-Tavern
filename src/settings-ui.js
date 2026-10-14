/**
 * Settings drawer in the SillyTavern "Extensions" panel.
 */

import { t, LANGUAGES, getLocale, getLang } from './i18n.js';
import { WALLETS } from './wallets.js';

const SIZES = ['s', 'm', 'l'];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
}

function option(value, label, selected) {
    return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function checkbox(id, label, checked) {
    return `<label class="checkbox_label tw-check" for="${id}">
        <input id="${id}" type="checkbox"${checked ? ' checked' : ''} />
        <span>${escapeHtml(label)}</span>
    </label>`;
}

/**
 * @typedef {object} SettingsHost
 * @property {() => any} settings
 * @property {() => void} save
 * @property {() => void} refreshAll
 * @property {() => string} rateStatus
 * @property {() => Promise<void>} refreshRate
 * @property {() => string} catalogStatus
 * @property {() => Promise<void>} refreshCatalog
 * @property {() => number} customRuleCount
 * @property {() => void} resetChatStats
 * @property {() => void} resetAllStats
 * @property {() => void} resetPosition
 * @property {() => void} testAnimation
 * @property {() => string} version
 */

export class SettingsPanel {
    /** @param {SettingsHost} host */
    constructor(host) {
        this.host = host;
        this.container = null;
    }

    mount() {
        const parent = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!parent) return false;
        this.container = document.createElement('div');
        this.container.id = 'token_wallet_settings';
        this.container.className = 'token-wallet-settings';
        parent.appendChild(this.container);
        this.render();
        return true;
    }

    /** Opens the drawer and scrolls to it */
    open() {
        const extensionsButton = document.querySelector('#extensions-settings-button .drawer-toggle');
        const drawerContent = document.getElementById('rm_extensions_block');
        if (extensionsButton && drawerContent && !drawerContent.classList.contains('openDrawer')) {
            extensionsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const content = this.container?.querySelector('.inline-drawer-content');
        const toggle = this.container?.querySelector('.inline-drawer-toggle');
        if (content && toggle && getComputedStyle(content).display === 'none') {
            toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        setTimeout(() => this.container?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    }

    render() {
        if (!this.container) return;
        const s = this.host.settings();
        const wasOpen = this.container.querySelector('.inline-drawer-content')?.style.display === 'block';

        this.container.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b><i class="fa-solid fa-wallet"></i> ${escapeHtml(t('title'))}${this.host.version() ? ` <small class="tw-version">v${escapeHtml(this.host.version())}</small>` : ''}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content tw-settings">
                ${checkbox('tw_enabled', t('enabled'), s.enabled)}

                <div class="tw-settings-grid">
                    <label for="tw_lang">${escapeHtml(t('language'))}</label>
                    <select id="tw_lang" class="text_pole">
                        ${LANGUAGES.map(l => option(l.id, l.label, s.lang === l.id)).join('')}
                    </select>

                    <label for="tw_currency">${escapeHtml(t('currency'))}</label>
                    <select id="tw_currency" class="text_pole">
                        ${option('RUB', t('currency_rub'), s.currency === 'RUB')}
                        ${option('USD', t('currency_usd'), s.currency === 'USD')}
                    </select>

                    <label for="tw_rate_mode">${escapeHtml(t('rate'))}</label>
                    <div class="tw-inline">
                        <select id="tw_rate_mode" class="text_pole">
                            ${option('auto', t('rate_auto'), s.rateMode === 'auto')}
                            ${option('manual', t('rate_manual'), s.rateMode === 'manual')}
                        </select>
                        <input id="tw_manual_rate" class="text_pole tw-rate-input" type="number" min="0" step="0.01"
                            value="${escapeHtml(s.manualRate)}" ${s.rateMode === 'manual' ? '' : 'style="display:none"'} />
                        <div id="tw_rate_refresh" class="menu_button menu_button_icon" title="${escapeHtml(t('refresh'))}" ${s.rateMode === 'auto' ? '' : 'style="display:none"'}>
                            <i class="fa-solid fa-rotate"></i>
                        </div>
                    </div>
                </div>
                <small id="tw_rate_status" class="tw-status">${escapeHtml(this.host.rateStatus())}</small>

                <label for="tw_timing" class="tw-block-label">${escapeHtml(t('input_timing'))}</label>
                <select id="tw_timing" class="text_pole">
                    ${option('send', t('timing_send'), s.inputTiming === 'send')}
                    ${option('response', t('timing_response'), s.inputTiming === 'response')}
                </select>
                <small class="tw-status">${escapeHtml(t('timing_hint'))}</small>

                <hr class="sysHR" />
                <b>${escapeHtml(t('appearance'))}</b>
                <div class="tw-block-label">${escapeHtml(t('wallet_style'))}</div>
                <div class="tw-wallet-picker" role="radiogroup">
                    ${WALLETS.map((wallet, index) => `
                    <button type="button" class="tw-wallet-option${s.wallet === wallet.id ? ' tw-active' : ''}" data-wallet="${escapeHtml(wallet.id)}"
                        role="radio" aria-checked="${s.wallet === wallet.id}" title="${escapeHtml(wallet.hint[getLang()] || wallet.hint.en)}">
                        ${wallet.render(`tw-pick-${index}`)}
                        <span>${escapeHtml(wallet.name[getLang()] || wallet.name.en)}</span>
                    </button>`).join('')}
                </div>
                <div class="tw-settings-grid">
                    <label for="tw_size">${escapeHtml(t('size'))}</label>
                    <select id="tw_size" class="text_pole">
                        ${SIZES.map(size => option(size, t(`size_${size}`), s.size === size)).join('')}
                    </select>
                </div>
                ${checkbox('tw_shine', t('shine'), s.shine)}
                ${checkbox('tw_show_wallet', t('show_wallet'), s.showWallet)}
                ${checkbox('tw_show_chat_total', t('show_chat_total'), s.showChatTotal)}
                ${checkbox('tw_show_message_cost', t('show_message_cost'), s.showMessageCost)}
                ${checkbox('tw_show_model', t('show_model'), s.showModelOnCoin)}
                ${checkbox('tw_track_background', t('track_background'), s.trackBackground)}
                ${checkbox('tw_track_embeddings', t('track_embeddings'), s.trackEmbeddings)}
                ${checkbox('tw_embedding_coins', t('embedding_coins'), s.embeddingCoins)}
                <small class="tw-status">${escapeHtml(t('embedding_hint'))}</small>
                <div class="tw-buttons">
                    <div id="tw_test" class="menu_button menu_button_icon"><i class="fa-solid fa-coins"></i><span>${escapeHtml(t('test_coin'))}</span></div>
                    <div id="tw_reset_position" class="menu_button menu_button_icon"><i class="fa-solid fa-arrows-to-dot"></i><span>${escapeHtml(t('reset_position'))}</span></div>
                </div>

                <hr class="sysHR" />
                <b>${escapeHtml(t('prices'))}</b>
                <div class="tw-inline">
                    <small id="tw_catalog_status" class="tw-status flex1">${escapeHtml(this.host.catalogStatus())}</small>
                    <div id="tw_catalog_refresh" class="menu_button menu_button_icon" title="${escapeHtml(t('refresh'))}"><i class="fa-solid fa-rotate"></i></div>
                </div>
                <label for="tw_custom_prices" class="tw-block-label">${escapeHtml(t('custom_prices'))}</label>
                <textarea id="tw_custom_prices" class="text_pole textarea_compact tw-prices" rows="4" spellcheck="false"
                    placeholder="gemini-2.5-pro = 1.25 / 10&#10;gemini-* = 0 / 0">${escapeHtml(s.customPrices)}</textarea>
                <small class="tw-status">${escapeHtml(t('custom_prices_hint'))} <span id="tw_rules_count">${escapeHtml(t('custom_prices_rules', { n: this.host.customRuleCount() }))}</span></small>

                <hr class="sysHR" />
                <b>${escapeHtml(t('stats'))}</b>
                <div class="tw-buttons">
                    <div id="tw_reset_chat" class="menu_button menu_button_icon"><i class="fa-solid fa-comment-slash"></i><span>${escapeHtml(t('reset_chat'))}</span></div>
                    <div id="tw_reset_all" class="menu_button menu_button_icon redWarningBG"><i class="fa-solid fa-trash-can"></i><span>${escapeHtml(t('reset_all'))}</span></div>
                </div>
            </div>
        </div>`;

        if (wasOpen) {
            const content = this.container.querySelector('.inline-drawer-content');
            const icon = this.container.querySelector('.inline-drawer-icon');
            if (content) content.style.display = 'block';
            icon?.classList.replace('down', 'up');
            icon?.classList.replace('fa-circle-chevron-down', 'fa-circle-chevron-up');
        }

        this.bind();
    }

    bind() {
        const s = () => this.host.settings();
        const $ = (id) => this.container.querySelector(`#${id}`);
        const onChange = (id, apply) => $(id)?.addEventListener('change', (event) => {
            apply(event.target);
            this.host.save();
            this.host.refreshAll();
        });

        onChange('tw_enabled', el => { s().enabled = el.checked; });
        onChange('tw_lang', el => {
            s().lang = el.value;
        });
        onChange('tw_currency', el => { s().currency = el.value; });
        onChange('tw_rate_mode', el => {
            s().rateMode = el.value;
            if (el.value === 'auto') this.host.refreshRate();
        });
        $('tw_manual_rate')?.addEventListener('input', (event) => {
            const value = Number(String(event.target.value).replace(',', '.'));
            if (Number.isFinite(value) && value > 0) {
                s().manualRate = value;
                this.host.save();
                this.updateStatus();
                this.host.refreshAll({ keepSettings: true });
            }
        });
        onChange('tw_timing', el => { s().inputTiming = el.value; });
        this.container.querySelectorAll('.tw-wallet-option').forEach((button) => {
            button.addEventListener('click', () => {
                s().wallet = button.getAttribute('data-wallet');
                this.host.save();
                this.host.refreshAll({ keepSettings: true });
                this.container.querySelectorAll('.tw-wallet-option').forEach((other) => {
                    const active = other === button;
                    other.classList.toggle('tw-active', active);
                    other.setAttribute('aria-checked', String(active));
                });
                this.host.testAnimation();
            });
        });
        onChange('tw_shine', el => { s().shine = el.checked; });
        onChange('tw_size', el => { s().size = el.value; });
        onChange('tw_show_wallet', el => { s().showWallet = el.checked; });
        onChange('tw_show_chat_total', el => { s().showChatTotal = el.checked; });
        onChange('tw_show_message_cost', el => { s().showMessageCost = el.checked; });
        onChange('tw_show_model', el => { s().showModelOnCoin = el.checked; });
        onChange('tw_track_background', el => { s().trackBackground = el.checked; });
        onChange('tw_track_embeddings', el => { s().trackEmbeddings = el.checked; });
        onChange('tw_embedding_coins', el => { s().embeddingCoins = el.checked; });

        $('tw_custom_prices')?.addEventListener('input', (event) => {
            s().customPrices = event.target.value;
            this.host.save();
            const counter = $('tw_rules_count');
            if (counter) counter.textContent = t('custom_prices_rules', { n: this.host.customRuleCount() });
        });

        $('tw_rate_refresh')?.addEventListener('click', async () => {
            const icon = $('tw_rate_refresh')?.querySelector('i');
            icon?.classList.add('fa-spin');
            await this.host.refreshRate(true);
            icon?.classList.remove('fa-spin');
        });
        $('tw_catalog_refresh')?.addEventListener('click', async () => {
            const icon = $('tw_catalog_refresh')?.querySelector('i');
            icon?.classList.add('fa-spin');
            await this.host.refreshCatalog(true);
            icon?.classList.remove('fa-spin');
        });
        $('tw_test')?.addEventListener('click', () => this.host.testAnimation());
        $('tw_reset_position')?.addEventListener('click', () => this.host.resetPosition());
        $('tw_reset_chat')?.addEventListener('click', () => this.host.resetChatStats());
        $('tw_reset_all')?.addEventListener('click', () => this.host.resetAllStats());
    }

    /** Refreshes status lines without re-rendering the form */
    updateStatus() {
        if (!this.container) return;
        const rate = this.container.querySelector('#tw_rate_status');
        if (rate) rate.textContent = this.host.rateStatus();
        const catalog = this.container.querySelector('#tw_catalog_status');
        if (catalog) catalog.textContent = this.host.catalogStatus();
    }
}

export function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}
