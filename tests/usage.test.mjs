import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBody, createSSEParser, normalizeUsage } from '../src/usage.js';

const sse = (...objects) => objects.map(o => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('');

test('OpenRouter stream: text, model, provider and exact cost from the last chunk', () => {
    const body = ': OPENROUTER PROCESSING\n\n' + sse(
        { id: 'gen-1', model: 'google/gemini-2.5-pro', provider: 'Google', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] },
        { id: 'gen-1', model: 'google/gemini-2.5-pro', provider: 'Google', choices: [{ index: 0, delta: { content: 'lo', reasoning: 'thinking' } }] },
        {
            id: 'gen-1', model: 'google/gemini-2.5-pro', provider: 'Google', choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
            usage: {
                prompt_tokens: 1200, completion_tokens: 350, total_tokens: 1550, cost: 0.005,
                is_byok: false,
                prompt_tokens_details: { cached_tokens: 1000 },
                completion_tokens_details: { reasoning_tokens: 200 },
                cost_details: { upstream_inference_cost: null },
            },
        },
        '[DONE]',
    );
    const state = parseBody(body, true);
    assert.equal(state.text, 'Hello');
    assert.equal(state.reasoning, 'thinking');
    assert.equal(state.model, 'google/gemini-2.5-pro');
    assert.equal(state.provider, 'Google');
    assert.equal(state.id, 'gen-1');
    assert.deepEqual(state.usage, { prompt: 1200, completion: 350, reasoning: 200, cacheRead: 1000, cost: 0.005 });
});

test('OpenRouter BYOK adds the upstream cost', () => {
    const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, cost: 0.0001, is_byok: true, cost_details: { upstream_inference_cost: 0.002 } });
    assert.equal(usage.cost, 0.0021);
});

test('OpenRouter cost split hints are kept when present', () => {
    const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, cost: 0.003, cost_details: { upstream_inference_prompt_cost: 0.001, upstream_inference_completions_cost: 0.002 } });
    assert.equal(usage.costIn, 0.001);
    assert.equal(usage.costOut, 0.002);
});

test('Non-streaming OpenAI-compatible JSON', () => {
    const state = parseBody(JSON.stringify({
        id: 'chatcmpl-1', model: 'deepseek-chat',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there', reasoning_content: 'hmm' } }],
        usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58, prompt_cache_hit_tokens: 32, prompt_cache_miss_tokens: 18 },
    }), false);
    assert.equal(state.text, 'Hi there');
    assert.equal(state.reasoning, 'hmm');
    assert.equal(state.usage.prompt, 50);
    assert.equal(state.usage.completion, 8);
    assert.equal(state.usage.cacheRead, 32);
});

test('Text completion stream (OpenRouter text mode)', () => {
    const state = parseBody(sse(
        { id: 'gen-2', model: 'mistralai/mistral-nemo', choices: [{ text: 'Once ' }] },
        { id: 'gen-2', model: 'mistralai/mistral-nemo', choices: [{ text: 'upon' }], usage: { prompt_tokens: 100, completion_tokens: 2, cost: 0.00001 } },
        '[DONE]',
    ), true);
    assert.equal(state.text, 'Once upon');
    assert.equal(state.usage.cost, 0.00001);
});

test('Claude raw stream: input from message_start, output from message_delta', () => {
    const body = [
        'event: message_start',
        `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', model: 'claude-sonnet-4-5-20250929', usage: { input_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, output_tokens: 1 } } })}`,
        '',
        'event: content_block_delta',
        `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think' } })}`,
        '',
        'event: content_block_delta',
        `data: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer' } })}`,
        '',
        'event: message_delta',
        `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 240 } })}`,
        '',
        'event: message_stop',
        `data: ${JSON.stringify({ type: 'message_stop' })}`,
        '',
    ].join('\r\n');
    const state = parseBody(body, true);
    assert.equal(state.text, 'Answer');
    assert.equal(state.reasoning, 'Let me think');
    assert.equal(state.model, 'claude-sonnet-4-5-20250929');
    assert.deepEqual(state.usage, { prompt: 1320, cacheRead: 1000, cacheWrite: 300, completion: 240 });
});

test('Gemini raw stream: cumulative usageMetadata, thoughts are output', () => {
    const state = parseBody(sse(
        { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }] } }], usageMetadata: { promptTokenCount: 900 }, modelVersion: 'gemini-2.5-pro' },
        { candidates: [{ content: { parts: [{ text: 'Hello' }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 5, thoughtsTokenCount: 120, cachedContentTokenCount: 512 } },
        { candidates: [{ content: { parts: [{ text: ' world' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 12, thoughtsTokenCount: 120, cachedContentTokenCount: 512 } },
    ), true);
    assert.equal(state.text, 'Hello world');
    assert.equal(state.reasoning, 'thinking...');
    assert.equal(state.model, 'gemini-2.5-pro');
    assert.deepEqual(state.usage, { prompt: 900, completion: 132, reasoning: 120, cacheRead: 512 });
});

test('xAI style usage: reasoning tokens outside completion_tokens', () => {
    const usage = normalizeUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 420, completion_tokens_details: { reasoning_tokens: 300 } });
    assert.equal(usage.completion, 320);
});

test('Cohere v2 message-end usage', () => {
    const state = parseBody(sse(
        { type: 'content-delta', delta: { message: { content: { text: 'Hey' } } } },
        { type: 'message-end', delta: { finish_reason: 'COMPLETE', usage: { billed_units: { input_tokens: 70, output_tokens: 3 } } } },
    ), true);
    assert.equal(state.text, 'Hey');
    assert.equal(state.usage.prompt, 70);
    assert.equal(state.usage.completion, 3);
});

test('Error chunk inside a stream is reported', () => {
    const state = parseBody(sse({ error: { message: 'Provider returned error', code: 502 } }), true);
    assert.equal(state.error, 'Provider returned error');
    assert.equal(state.usage, null);
});

test('SSE parser handles chunks split at arbitrary positions', () => {
    const payloads = [];
    const parser = createSSEParser(data => payloads.push(data));
    const text = sse({ a: 1 }, { b: 'x\ny' }, '[DONE]');
    for (let i = 0; i < text.length; i += 3) parser.push(text.slice(i, i + 3));
    parser.end();
    assert.deepEqual(payloads, ['{"a":1}', '{"b":"x\\ny"}', '[DONE]']);
});

test('SSE parser copes with events not separated by blank lines', () => {
    const payloads = [];
    const parser = createSSEParser(data => payloads.push(data));
    parser.push('data: {"a":1}\ndata: {"b":2}\n');
    parser.end();
    assert.deepEqual(payloads, ['{"a":1}', '{"b":2}']);
});
