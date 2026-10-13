import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PriceCatalog,
    compactCatalogModel,
    computeCost,
    estimateInputCost,
    findCustomPrice,
    keyVariants,
    normalizeModelKey,
    parseCustomPrices,
} from '../src/pricing.js';

const raw = [
    { id: 'google/gemini-2.5-pro', pricing: { prompt: '0.00000125', completion: '0.00001', input_cache_read: '0.00000031', input_cache_write: '0.000001625' } },
    { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
    { id: 'google/gemini-2.0-flash-001', pricing: { prompt: '0.0000001', completion: '0.0000004' } },
    { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' } },
    { id: 'anthropic/claude-3.7-sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
    { id: 'anthropic/claude-opus-4.1', pricing: { prompt: '0.000015', completion: '0.000075' } },
    { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
    { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    { id: 'deepseek/deepseek-chat', pricing: { prompt: '0.0000003', completion: '0.00000085' } },
    { id: 'deepseek/deepseek-chat-v3-0324:free', pricing: { prompt: '0', completion: '0' } },
    { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
];

function makeCatalog() {
    const models = {};
    for (const m of raw) {
        const price = compactCatalogModel(m);
        if (price) models[m.id] = price;
    }
    return new PriceCatalog(models);
}

test('catalog skips models with negative (dynamic) pricing', () => {
    const catalog = makeCatalog();
    assert.equal(catalog.find('openrouter', 'openrouter/auto'), null);
    assert.equal(catalog.size, raw.length - 1);
});

test('normalizeModelKey unifies provider id styles', () => {
    assert.equal(normalizeModelKey('anthropic/claude-3.5-sonnet'), 'claude-3-5-sonnet');
    assert.equal(normalizeModelKey('claude-3-5-sonnet'), 'claude-3-5-sonnet');
    assert.equal(normalizeModelKey('models/gemini-2.5-pro'), 'gemini-2-5-pro');
    assert.equal(normalizeModelKey('deepseek/deepseek-chat-v3-0324:free'), 'deepseek-chat-v3-0324');
});

test('keyVariants strips dates and preview suffixes step by step', () => {
    assert.deepEqual(keyVariants('claude-opus-4-1-20250805'), ['claude-opus-4-1-20250805', 'claude-opus-4-1']);
    assert.ok(keyVariants('gemini-2-5-flash-preview-05-20').includes('gemini-2-5-flash'));
    assert.ok(keyVariants('claude-3-7-sonnet-latest').includes('claude-3-7-sonnet'));
    assert.deepEqual(keyVariants('gpt-4o-mini'), ['gpt-4o-mini']);
});

test('exact OpenRouter ids, including :free variants', () => {
    const catalog = makeCatalog();
    assert.equal(catalog.find('openrouter', 'google/gemini-2.5-pro').p, 0.00000125);
    assert.equal(catalog.find('openrouter', 'deepseek/deepseek-chat-v3-0324:free').p, 0);
});

test('direct providers are matched to the OpenRouter catalog', () => {
    const catalog = makeCatalog();
    assert.equal(catalog.find('makersuite', 'gemini-2.5-pro').id, 'google/gemini-2.5-pro');
    assert.equal(catalog.find('vertexai', 'gemini-2.5-flash-preview-05-20').id, 'google/gemini-2.5-flash');
    assert.equal(catalog.find('makersuite', 'gemini-2.0-flash-001').id, 'google/gemini-2.0-flash-001');
    assert.equal(catalog.find('claude', 'claude-sonnet-4-5-20250929').id, 'anthropic/claude-sonnet-4.5');
    assert.equal(catalog.find('claude', 'claude-sonnet-4-5').id, 'anthropic/claude-sonnet-4.5');
    assert.equal(catalog.find('claude', 'claude-3-7-sonnet-latest').id, 'anthropic/claude-3.7-sonnet');
    assert.equal(catalog.find('claude', 'claude-opus-4-1-20250805').id, 'anthropic/claude-opus-4.1');
    assert.equal(catalog.find('openai', 'gpt-4o-mini').id, 'openai/gpt-4o-mini');
    assert.equal(catalog.find('openai', 'gpt-4o-2024-08-06').id, 'openai/gpt-4o');
    assert.equal(catalog.find('deepseek', 'deepseek-chat').id, 'deepseek/deepseek-chat');
    assert.equal(catalog.find('makersuite', 'gemini-unknown-9'), null);
});

test('custom prices: exact, normalized and wildcard rules', () => {
    const rules = parseCustomPrices(`
        # comment
        gemini-2.5-pro = 1.25 / 10
        my-local-model = 0,5 / 1,5 / 0,1
        gemini-* = 0 / 0
        broken line
        bad = x / 1
    `);
    assert.equal(rules.length, 3);
    assert.equal(findCustomPrice(rules, 'models/gemini-2.5-pro').p, 1.25e-6);
    assert.equal(findCustomPrice(rules, 'google/gemini-2.5-pro').c, 10e-6);
    assert.ok(Math.abs(findCustomPrice(rules, 'my_local.model').cr - 0.1e-6) < 1e-15);
    assert.equal(findCustomPrice(rules, 'gemini-2.5-flash').p, 0);
    assert.equal(findCustomPrice(rules, 'gpt-4o'), null);
});

test('price list cost with cache read/write', () => {
    const price = { p: 3e-6, c: 15e-6, cr: 0.3e-6, cw: 3.75e-6 };
    const cost = computeCost({ prompt: 10000, completion: 500, cacheRead: 8000, cacheWrite: 1000 }, price);
    const expectedIn = 1000 * 3e-6 + 8000 * 0.3e-6 + 1000 * 3.75e-6;
    assert.ok(Math.abs(cost.inUsd - expectedIn) < 1e-12);
    assert.ok(Math.abs(cost.outUsd - 500 * 15e-6) < 1e-12);
    assert.equal(cost.exact, false);
});

test('exact OpenRouter bill is kept and split by list prices', () => {
    const price = { p: 1e-6, c: 4e-6 };
    const cost = computeCost({ prompt: 1000, completion: 1000, cost: 0.01 }, price);
    assert.equal(cost.exact, true);
    assert.equal(cost.usd, 0.01);
    assert.ok(Math.abs(cost.inUsd - 0.002) < 1e-12);
    assert.ok(Math.abs(cost.outUsd - 0.008) < 1e-12);
});

test('exact bill uses provider split hints first', () => {
    const cost = computeCost({ prompt: 10, completion: 10, cost: 0.004, costIn: 0.001, costOut: 0.003 }, { p: 1, c: 1 });
    assert.ok(Math.abs(cost.inUsd - 0.001) < 1e-12);
});

test('exact bill without any price still gets a sensible split', () => {
    const cost = computeCost({ prompt: 4000, completion: 1000, cost: 0.016 }, null);
    assert.equal(cost.usd, 0.016);
    assert.ok(Math.abs(cost.inUsd - 0.008) < 1e-12);
});

test('free model with exact zero cost', () => {
    const cost = computeCost({ prompt: 4000, completion: 1000, cost: 0 }, { p: 0, c: 0 });
    assert.deepEqual(cost, { inUsd: 0, outUsd: 0, usd: 0, exact: true });
});

test('no price and no bill -> null', () => {
    assert.equal(computeCost({ prompt: 100, completion: 10 }, null), null);
});

test('input estimate', () => {
    assert.equal(estimateInputCost(1000, { p: 2e-6, c: 0 }), 0.002);
    assert.equal(estimateInputCost(1000, null), null);
});
