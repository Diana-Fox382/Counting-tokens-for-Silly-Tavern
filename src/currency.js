/**
 * Currency conversion and money formatting.
 * Every amount is stored in USD (OpenRouter credits and provider prices are in USD)
 * and converted only for display.
 */

import { getLocale } from './i18n.js';

export const FALLBACK_USD_RUB = 80;

const RATE_SOURCES = [
    {
        name: 'ЦБ РФ',
        url: 'https://www.cbr-xml-daily.ru/daily_json.js',
        parse: (json) => {
            const usd = json?.Valute?.USD;
            const value = Number(usd?.Value) / (Number(usd?.Nominal) || 1);
            return { value, date: json?.Date };
        },
    },
    {
        name: 'open.er-api.com',
        url: 'https://open.er-api.com/v6/latest/USD',
        parse: (json) => ({ value: Number(json?.rates?.RUB), date: json?.time_last_update_utc }),
    },
];

async function fetchJson(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Loads the current USD→RUB rate. Tries the Bank of Russia mirror first.
 * @returns {Promise<{value: number, date: string, source: string, fetchedAt: number}>}
 */
export async function fetchUsdRubRate() {
    let lastError = null;
    for (const source of RATE_SOURCES) {
        try {
            const json = await fetchJson(source.url);
            const { value, date } = source.parse(json);
            if (Number.isFinite(value) && value > 0) {
                const parsedDate = date ? new Date(date) : new Date();
                return {
                    value,
                    date: Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
                    source: source.name,
                    fetchedAt: Date.now(),
                };
            }
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('No exchange rate source available');
}

/**
 * Number of fraction digits that keeps ~3 significant digits for small amounts.
 * @param {number} abs
 */
function fractionDigits(abs) {
    if (abs === 0) return [0, 0];
    if (abs >= 100) return [0, 2];
    if (abs >= 1) return [2, 2];
    const digits = Math.min(6, -Math.floor(Math.log10(abs)) + 2);
    return [2, Math.max(2, digits)];
}

/**
 * @param {number} usd Amount in USD
 * @param {'RUB'|'USD'} currency
 * @param {number} rate USD→RUB rate
 * @param {object} [options]
 * @param {boolean} [options.minus] Prefix with a minus sign (money leaving the wallet)
 */
export function formatMoney(usd, currency, rate, { minus = false } = {}) {
    const value = currency === 'RUB' ? usd * rate : usd;
    const abs = Math.abs(value);
    const [min, max] = fractionDigits(abs);
    const number = new Intl.NumberFormat(getLocale(), {
        minimumFractionDigits: min,
        maximumFractionDigits: max,
    }).format(abs);
    const sign = minus && abs > 0 ? '−' : (value < 0 ? '−' : '');
    return currency === 'RUB' ? `${sign}${number} ₽` : `${sign}$${number}`;
}

/**
 * Short token counter: 950, 12.3k, 1.2M
 * @param {number} tokens
 */
export function formatTokens(tokens) {
    const n = Math.max(0, Math.round(tokens || 0));
    const locale = getLocale();
    if (n < 1000) return n.toLocaleString(locale);
    if (n < 1e6) return `${(n / 1000).toLocaleString(locale, { maximumFractionDigits: n < 1e4 ? 1 : 0 })}k`;
    return `${(n / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
}

/** Full token counter with thousands separators */
export function formatTokensFull(tokens) {
    return Math.max(0, Math.round(tokens || 0)).toLocaleString(getLocale());
}

/** @param {'RUB'|'USD'} currency */
export function currencySymbol(currency) {
    return currency === 'RUB' ? '₽' : '$';
}
