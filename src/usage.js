/**
 * Parsing of provider responses (streaming SSE chunks and plain JSON) into a
 * provider-agnostic usage record.
 *
 * Supported shapes:
 *  - OpenAI-compatible (OpenRouter, OpenAI, DeepSeek, xAI, Mistral, Groq, custom...):
 *    `usage.prompt_tokens / completion_tokens`, OpenRouter adds `usage.cost`.
 *  - Anthropic Claude: `message_start.message.usage`, `message_delta.usage`.
 *  - Google Gemini (AI Studio / Vertex): `usageMetadata`.
 *  - Cohere v2: `message-end.delta.usage`.
 *
 * Everything here is pure and has no SillyTavern dependencies, so it can be unit-tested in Node.
 */

/**
 * @typedef {object} NormalizedUsage
 * @property {number} [prompt] Total prompt tokens (cached ones included)
 * @property {number} [completion] Output tokens (reasoning included)
 * @property {number} [cacheRead] Prompt tokens read from cache
 * @property {number} [cacheWrite] Prompt tokens written to cache
 * @property {number} [reasoning] Reasoning tokens (already part of completion)
 * @property {number} [cost] Exact total cost in USD reported by the provider
 * @property {number} [costIn] Provider-reported input part of the cost
 * @property {number} [costOut] Provider-reported output part of the cost
 */

/**
 * @typedef {object} StreamState
 * @property {string} text Generated text
 * @property {string} reasoning Generated reasoning text
 * @property {NormalizedUsage|null} usage
 * @property {string|null} model Model reported by the provider
 * @property {string|null} provider Upstream provider (OpenRouter)
 * @property {string|null} id Generation id
 * @property {string|null} error Error message reported inside the response
 */

/** @returns {StreamState} */
export function createStreamState() {
    return { text: '', reasoning: '', usage: null, model: null, provider: null, id: null, error: null };
}

function toNum(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function has(obj, key) {
    return obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== null && obj[key] !== undefined;
}

/**
 * Converts any known `usage` object into NormalizedUsage.
 * Only fields that are actually present are set, so partial updates
 * (e.g. Claude `message_delta` with output tokens only) can be merged.
 * @param {any} u
 * @returns {NormalizedUsage|null}
 */
export function normalizeUsage(u) {
    if (!u || typeof u !== 'object') return null;
    /** @type {NormalizedUsage} */
    const n = {};

    if (has(u, 'prompt_tokens') || has(u, 'completion_tokens')) {
        // OpenAI-compatible
        const prompt = toNum(u.prompt_tokens);
        let completion = toNum(u.completion_tokens);
        const reasoning = toNum(u.completion_tokens_details?.reasoning_tokens) ?? toNum(u.reasoning_tokens);
        const total = toNum(u.total_tokens);

        // Some providers (xAI) report reasoning tokens outside of completion_tokens.
        if (completion !== undefined && reasoning && prompt !== undefined && total !== undefined
            && total >= prompt + completion + reasoning) {
            completion += reasoning;
        }

        if (prompt !== undefined) n.prompt = prompt;
        if (completion !== undefined) n.completion = completion;
        if (reasoning !== undefined) n.reasoning = reasoning;

        const cacheRead = toNum(u.prompt_tokens_details?.cached_tokens) ?? toNum(u.prompt_cache_hit_tokens);
        if (cacheRead !== undefined) n.cacheRead = cacheRead;
        const cacheWrite = toNum(u.prompt_tokens_details?.cache_write_tokens) ?? toNum(u.prompt_tokens_details?.cache_creation_tokens);
        if (cacheWrite !== undefined) n.cacheWrite = cacheWrite;

        // OpenRouter exact accounting (credits are USD)
        let cost = toNum(u.cost);
        const details = u.cost_details && typeof u.cost_details === 'object' ? u.cost_details : null;
        const upstream = toNum(details?.upstream_inference_cost);
        if (u.is_byok && upstream !== undefined) {
            // BYOK: OpenRouter fee + what the upstream provider bills to the user's own key
            cost = (cost ?? 0) + upstream;
        }
        if (cost !== undefined) n.cost = cost;

        const costIn = toNum(details?.upstream_inference_prompt_cost) ?? toNum(details?.upstream_inference_input_cost);
        const costOut = toNum(details?.upstream_inference_completions_cost) ?? toNum(details?.upstream_inference_output_cost);
        if (costIn !== undefined && costOut !== undefined) {
            n.costIn = costIn;
            n.costOut = costOut;
        }
        return n;
    }

    if (has(u, 'input_tokens') || has(u, 'output_tokens')) {
        // Anthropic / Cohere: input_tokens does NOT include cached tokens
        const cacheRead = toNum(u.cache_read_input_tokens);
        const cacheWrite = toNum(u.cache_creation_input_tokens);
        const input = toNum(u.input_tokens);
        if (input !== undefined) n.prompt = input + (cacheRead ?? 0) + (cacheWrite ?? 0);
        if (cacheRead !== undefined) n.cacheRead = cacheRead;
        if (cacheWrite !== undefined) n.cacheWrite = cacheWrite;
        const output = toNum(u.output_tokens);
        if (output !== undefined) n.completion = output;
        return n;
    }

    if (has(u, 'billed_units')) {
        return normalizeUsage(u.billed_units);
    }

    return Object.keys(n).length ? n : null;
}

/**
 * Converts Gemini `usageMetadata` into NormalizedUsage.
 * @param {any} m
 * @returns {NormalizedUsage|null}
 */
export function normalizeGeminiUsage(m) {
    if (!m || typeof m !== 'object') return null;
    /** @type {NormalizedUsage} */
    const n = {};
    const prompt = toNum(m.promptTokenCount);
    const toolPrompt = toNum(m.toolUsePromptTokenCount) ?? 0;
    const candidates = toNum(m.candidatesTokenCount);
    const thoughts = toNum(m.thoughtsTokenCount);
    const cached = toNum(m.cachedContentTokenCount);
    if (prompt !== undefined) n.prompt = prompt + toolPrompt;
    if (candidates !== undefined || thoughts !== undefined) n.completion = (candidates ?? 0) + (thoughts ?? 0);
    if (thoughts !== undefined) n.reasoning = thoughts;
    if (cached !== undefined) n.cacheRead = cached;
    return Object.keys(n).length ? n : null;
}

/**
 * Merges a partial usage update into the state.
 * @param {StreamState} state
 * @param {NormalizedUsage|null} update
 */
function mergeUsage(state, update) {
    if (!update) return;
    state.usage = Object.assign(state.usage || {}, update);
}

function extractText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : ''))).join('');
    }
    return '';
}

/**
 * Feeds one parsed JSON object (an SSE `data:` payload or a whole JSON response) into the state.
 * @param {StreamState} state
 * @param {any} obj
 */
export function consumeChunk(state, obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.error) {
        const err = obj.error;
        state.error = typeof err === 'string' ? err : (err.message || JSON.stringify(err)).slice(0, 300);
    }

    if (typeof obj.id === 'string' && !state.id) state.id = obj.id;
    if (typeof obj.model === 'string' && obj.model) state.model = obj.model;
    if (typeof obj.provider === 'string' && obj.provider) state.provider = obj.provider;

    // OpenAI-compatible chat / text completions
    if (Array.isArray(obj.choices)) {
        for (const choice of obj.choices) {
            if (!choice || typeof choice !== 'object') continue;
            // Multi-swipe (n > 1) chunks are billed too, so every choice is counted.
            const delta = choice.delta || choice.message;
            if (delta && typeof delta === 'object') {
                state.text += extractText(delta.content);
                if (typeof delta.reasoning === 'string') state.reasoning += delta.reasoning;
                if (typeof delta.reasoning_content === 'string') state.reasoning += delta.reasoning_content;
            }
            if (typeof choice.text === 'string') state.text += choice.text;
        }
    }

    // OpenAI-compatible `usage`, also Claude `message_delta.usage` (cumulative output tokens)
    if (obj.usage && typeof obj.usage === 'object') {
        mergeUsage(state, normalizeUsage(obj.usage));
    }

    // Anthropic Claude (raw SSE forwarded by SillyTavern)
    if (obj.type === 'message_start' && obj.message) {
        if (typeof obj.message.model === 'string') state.model = obj.message.model;
        if (typeof obj.message.id === 'string' && !state.id) state.id = obj.message.id;
        mergeUsage(state, normalizeUsage(obj.message.usage));
    }
    if (obj.type === 'content_block_delta' && obj.delta) {
        if (typeof obj.delta.text === 'string') state.text += obj.delta.text;
        if (typeof obj.delta.thinking === 'string') state.reasoning += obj.delta.thinking;
    }

    // Google Gemini (AI Studio / Vertex AI)
    if (Array.isArray(obj.candidates)) {
        const parts = obj.candidates[0]?.content?.parts;
        if (Array.isArray(parts)) {
            for (const part of parts) {
                if (typeof part?.text !== 'string') continue;
                if (part.thought) state.reasoning += part.text;
                else state.text += part.text;
            }
        }
    }
    if (obj.usageMetadata) {
        // Gemini sends cumulative counters, the last chunk wins
        mergeUsage(state, normalizeGeminiUsage(obj.usageMetadata));
    }
    if (typeof obj.modelVersion === 'string' && obj.modelVersion) state.model = obj.modelVersion;

    // Cohere v2
    if (obj.type === 'content-delta') {
        state.text += extractText(obj.delta?.message?.content?.text);
    }
    if (obj.type === 'message-end' && obj.delta?.usage) {
        mergeUsage(state, normalizeUsage(obj.delta.usage.billed_units || obj.delta.usage.tokens));
    }
}

/**
 * Minimal incremental Server-Sent Events parser.
 * @param {(data: string) => void} onData Called for every complete `data:` payload
 */
export function createSSEParser(onData) {
    let buffer = '';
    let dataLines = [];

    const dispatch = () => {
        if (dataLines.length) {
            const data = dataLines.join('\n');
            dataLines = [];
            onData(data);
        }
    };

    const handleLine = (line) => {
        if (line === '') {
            dispatch();
            return;
        }
        if (line.startsWith(':')) return; // comment, e.g. ": OPENROUTER PROCESSING"
        if (line.startsWith('data:')) {
            let value = line.slice(5);
            if (value.startsWith(' ')) value = value.slice(1);
            // Some servers omit the blank line between events: a new JSON object starts a new event.
            if (dataLines.length && value.startsWith('{') && isCompleteJson(dataLines.join('\n'))) {
                dispatch();
            }
            dataLines.push(value);
        }
        // `event:`, `id:`, `retry:` are not needed
    };

    return {
        /** @param {string} chunk */
        push(chunk) {
            buffer += chunk;
            let index;
            while ((index = buffer.search(/\r?\n|\r/)) !== -1) {
                const line = buffer.slice(0, index);
                const match = buffer.slice(index).match(/^(\r\n|\n|\r)/);
                buffer = buffer.slice(index + (match ? match[0].length : 1));
                handleLine(line);
            }
        },
        end() {
            if (buffer.length) {
                handleLine(buffer);
                buffer = '';
            }
            dispatch();
        },
    };
}

function isCompleteJson(text) {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parses a complete response body (used for tests and as a fallback).
 * @param {string} body Raw body
 * @param {boolean} isStream Whether the body is an SSE stream
 * @returns {StreamState}
 */
export function parseBody(body, isStream) {
    const state = createStreamState();
    if (isStream) {
        let events = 0;
        const parser = createSSEParser((data) => {
            events++;
            if (data === '[DONE]') return;
            try {
                consumeChunk(state, JSON.parse(data));
            } catch {
                // ignore malformed chunks
            }
        });
        parser.push(body);
        parser.end();
        if (events > 0) return state;
    }
    try {
        consumeChunk(state, JSON.parse(body));
    } catch {
        // not JSON
    }
    return state;
}
