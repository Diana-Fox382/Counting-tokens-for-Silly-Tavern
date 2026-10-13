/**
 * Watches SillyTavern's own generation requests in the browser.
 *
 * SillyTavern sends every generation through its server
 * (`/api/backends/chat-completions/generate` or `/api/backends/text-completions/generate`)
 * and forwards the provider response back unchanged. The wrapper below reads a copy
 * (`Response.clone()`) of that response, so SillyTavern itself is not affected and
 * no API key or server-side change is needed. It works the same way for a local
 * SillyTavern and for one running on a remote server.
 */

import { consumeChunk, createSSEParser, createStreamState } from './usage.js';

const CHAT_PATH = '/api/backends/chat-completions/generate';
const TEXT_PATH = '/api/backends/text-completions/generate';
const HOOK_FLAG = '__tokenWalletFetchHook';

/**
 * @typedef {object} RequestInfo
 * @property {'chat'|'text'} kind
 * @property {string} source Chat completion source or `tc:<api_type>`
 * @property {string|null} model Requested model
 * @property {string|undefined} type Generation type sent by SillyTavern (normal, swipe, quiet...)
 * @property {boolean} stream
 * @property {any} body Parsed request body
 */

/**
 * @typedef {object} ResponseResult
 * @property {boolean} ok HTTP status was OK
 * @property {number} status
 * @property {boolean} aborted Stream was interrupted (user pressed Stop, network error)
 * @property {string|null} httpError Error body for non-OK responses
 * @property {import('./usage.js').StreamState} state
 */

/**
 * @param {RequestInfo|any} input
 * @param {RequestInit|undefined} init
 * @returns {RequestInfo|null}
 */
function inspectRequest(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
    if (!url) return null;

    let path;
    try {
        path = new URL(url, window.location.href).pathname;
    } catch {
        return null;
    }

    const isChat = path.endsWith(CHAT_PATH);
    const isText = path.endsWith(TEXT_PATH);
    if (!isChat && !isText) return null;
    if (typeof init?.body !== 'string') return null;

    let body;
    try {
        body = JSON.parse(init.body);
    } catch {
        return null;
    }
    if (!body || typeof body !== 'object') return null;

    return {
        kind: isChat ? 'chat' : 'text',
        source: isChat ? String(body.chat_completion_source || 'unknown') : `tc:${body.api_type || 'unknown'}`,
        model: typeof body.model === 'string' && body.model ? body.model : null,
        type: typeof body.type === 'string' ? body.type : undefined,
        stream: Boolean(body.stream),
        body,
    };
}

/**
 * Reads the cloned response and collects text + usage.
 * @param {Response} response
 * @param {RequestInfo} info
 * @returns {Promise<ResponseResult>}
 */
async function readResponse(response, info) {
    /** @type {ResponseResult} */
    const result = { ok: response.ok, status: response.status, aborted: false, httpError: null, state: createStreamState() };

    if (!response.ok) {
        result.httpError = (await response.text().catch(() => '')).slice(0, 500) || `HTTP ${response.status}`;
        return result;
    }

    if (!info.stream || !response.body) {
        const text = await response.text();
        try {
            consumeChunk(result.state, JSON.parse(text));
        } catch {
            // not JSON
        }
        return result;
    }

    let events = 0;
    let head = '';
    const parser = createSSEParser((data) => {
        events++;
        if (data === '[DONE]') return;
        try {
            consumeChunk(result.state, JSON.parse(data));
        } catch {
            // ignore malformed chunk
        }
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (head.length < 4096) head += chunk;
            parser.push(chunk);
        }
        parser.push(decoder.decode());
        parser.end();
    } catch {
        result.aborted = true;
        parser.end();
    }

    // The server may answer a streaming request with a plain JSON error
    if (events === 0 && head.trim().startsWith('{')) {
        try {
            consumeChunk(result.state, JSON.parse(head));
        } catch {
            // ignore
        }
    }

    return result;
}

/**
 * @param {object} handlers
 * @param {() => boolean} handlers.isEnabled
 * @param {(info: RequestInfo) => any} handlers.onStart Returns a record object or null to skip
 * @param {(record: any, result: ResponseResult) => void} handlers.onFinish
 */
export function installFetchInterceptor({ isEnabled, onStart, onFinish }) {
    if (window[HOOK_FLAG]) {
        // Extension module re-evaluated (hot reload): just swap handlers
        window[HOOK_FLAG].handlers = { isEnabled, onStart, onFinish };
        return;
    }

    const originalFetch = window.fetch;
    const hook = { handlers: { isEnabled, onStart, onFinish } };
    window[HOOK_FLAG] = hook;

    const safeFinish = (record, result) => {
        try {
            hook.handlers.onFinish(record, result);
        } catch (error) {
            console.warn('[Token Wallet] finish handler failed', error);
        }
    };

    window.fetch = function tokenWalletFetch(input, init) {
        let info = null;
        let record = null;
        try {
            if (hook.handlers.isEnabled()) {
                info = inspectRequest(input, init);
                if (info) record = hook.handlers.onStart(info);
            }
        } catch (error) {
            console.warn('[Token Wallet] request inspection failed', error);
            record = null;
        }

        const promise = originalFetch.apply(globalThis, arguments);
        if (!record) return promise;

        return promise.then(
            (response) => {
                try {
                    const copy = response.clone();
                    readResponse(copy, info)
                        .then(result => safeFinish(record, result))
                        .catch(error => safeFinish(record, {
                            ok: response.ok,
                            status: response.status,
                            aborted: true,
                            httpError: null,
                            state: createStreamState(),
                            readError: String(error),
                        }));
                } catch (error) {
                    console.warn('[Token Wallet] could not clone response', error);
                    safeFinish(record, { ok: false, status: 0, aborted: false, httpError: String(error), state: createStreamState() });
                }
                return response;
            },
            (error) => {
                const aborted = error?.name === 'AbortError';
                safeFinish(record, { ok: false, status: 0, aborted, httpError: aborted ? null : String(error), state: createStreamState() });
                throw error;
            },
        );
    };
}
