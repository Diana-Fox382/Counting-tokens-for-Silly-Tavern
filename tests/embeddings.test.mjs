import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    EMBEDDING_CATALOG_SOURCE,
    EMBEDDING_FALLBACK_PRICES,
    isOpenAiEmbeddingModel,
    parseEmbeddingRequest,
    stripMessageOverhead,
} from '../src/embeddings.js';
import { PriceCatalog } from '../src/pricing.js';

test('insert request: every new item is embedded', () => {
    const request = parseEmbeddingRequest('/api/vector/insert', {
        source: 'openrouter',
        model: 'openai/text-embedding-3-large',
        collectionId: 'chat-1',
        items: [{ hash: 1, text: 'Hello', index: 0 }, { hash: 2, text: 'World', index: 1 }, { hash: 3, text: '', index: 2 }],
    });
    assert.deepEqual(request, { action: 'insert', source: 'openrouter', model: 'openai/text-embedding-3-large', texts: ['Hello', 'World'] });
});

test('query and query-multi embed the search text once', () => {
    const body = { source: 'openai', searchText: 'Where is the castle?', collectionIds: ['a', 'b'] };
    assert.deepEqual(parseEmbeddingRequest('/api/vector/query-multi', body).texts, ['Where is the castle?']);
    const single = parseEmbeddingRequest('/api/vector/query', { source: 'openai', searchText: 'x' });
    assert.equal(single.action, 'query');
    assert.equal(single.model, 'text-embedding-ada-002'); // SillyTavern default for the OpenAI source
});

test('requests that embed nothing are ignored', () => {
    assert.equal(parseEmbeddingRequest('/api/vector/list', { source: 'openai' }), null);
    assert.equal(parseEmbeddingRequest('/api/vector/purge', { source: 'openai', collectionId: 'x' }), null);
    assert.equal(parseEmbeddingRequest('/api/vector/insert', { source: 'openai', items: [] }), null);
    // WebLLM / KoboldCpp send ready-made vectors
    assert.equal(parseEmbeddingRequest('/api/vector/query', { source: 'webllm', searchText: 'x', embeddings: { x: [0.1] } }), null);
});

test('token count overhead of the SillyTavern counter is removed', () => {
    // /api/tokenizers/openai/count: 3 per message + 3 at the end
    assert.equal(stripMessageOverhead(2 + 3 + 3, 1), 2);
    assert.equal(stripMessageOverhead(486 + 1112 + 3 * 2 + 3, 2), 1598);
});

test('OpenAI embedding models are recognized', () => {
    assert.ok(isOpenAiEmbeddingModel('openai/text-embedding-3-large'));
    assert.ok(isOpenAiEmbeddingModel('text-embedding-3-small'));
    assert.ok(!isOpenAiEmbeddingModel('qwen/qwen3-embedding-8b'));
});

test('fallback prices match the OpenRouter bill from the screenshot', () => {
    const catalog = new PriceCatalog(EMBEDDING_FALLBACK_PRICES);
    const viaOpenRouter = catalog.find(EMBEDDING_CATALOG_SOURCE.openrouter, 'openai/text-embedding-3-large');
    // 486 tokens were billed $0.0000632 by OpenRouter
    assert.ok(Math.abs(486 * viaOpenRouter.p - 0.0000632) < 0.0000001);
    const direct = catalog.find(EMBEDDING_CATALOG_SOURCE.openai, 'text-embedding-3-small');
    assert.equal(direct.id, 'openai/text-embedding-3-small');
});
