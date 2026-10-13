/**
 * Embedding requests of the SillyTavern "Vector Storage" extension.
 *
 * The browser sends the texts to `/api/vector/insert` (new chat messages, files, lorebook entries)
 * and `/api/vector/query` / `/api/vector/query-multi` (text to search with). The SillyTavern server
 * then calls the embedding API (OpenRouter, OpenAI, Google...) and does not return any usage,
 * so tokens are counted from the texts and priced by the model price.
 *
 * Pure module, no SillyTavern dependencies.
 */

const VECTOR_PATHS = {
    '/api/vector/insert': 'insert',
    '/api/vector/query': 'query',
    '/api/vector/query-multi': 'query',
};

/** Models the server uses when the request does not name one */
const DEFAULT_MODELS = {
    openrouter: 'openai/text-embedding-3-large',
    openai: 'text-embedding-ada-002',
    electronhub: 'text-embedding-3-small',
    nanogpt: 'text-embedding-3-small',
    mistral: 'mistral-embed',
    nomicai: 'nomic-embed-text-v1.5',
    cohere: 'embed-english-v3.0',
    palm: 'text-embedding-005',
    vertexai: 'text-embedding-005',
};

/** Embedding sources that are billed. Local ones (transformers, ollama, llamacpp, koboldcpp, webllm...) are free. */
export const PAID_EMBEDDING_SOURCES = new Set([
    'openrouter', 'openai', 'electronhub', 'nanogpt', 'chutes', 'mistral', 'nomicai', 'cohere',
    'togetherai', 'palm', 'vertexai', 'siliconflow', 'workers_ai',
]);

/**
 * Official OpenAI embedding prices (USD per token), used when the OpenRouter catalog is not available.
 * OpenRouter bills these models at the same price.
 */
export const EMBEDDING_FALLBACK_PRICES = {
    'openai/text-embedding-3-small': { p: 0.02e-6, c: 0 },
    'openai/text-embedding-3-large': { p: 0.13e-6, c: 0 },
    'openai/text-embedding-ada-002': { p: 0.10e-6, c: 0 },
};

/** Chat completion source whose vendor prefix matches the embedding source in the OpenRouter catalog */
export const EMBEDDING_CATALOG_SOURCE = {
    openrouter: 'openrouter',
    openai: 'openai',
    electronhub: 'openai',
    nanogpt: 'openai',
    mistral: 'mistralai',
    cohere: 'cohere',
    palm: 'makersuite',
    vertexai: 'makersuite',
};

/**
 * @typedef {object} EmbeddingRequest
 * @property {'insert'|'query'} action
 * @property {string} source Vector Storage source (openrouter, openai, palm...)
 * @property {string|null} model
 * @property {string[]} texts Texts that will be embedded (and billed)
 */

/**
 * @param {string} path URL path of the request
 * @param {any} body Parsed request body
 * @returns {EmbeddingRequest|null}
 */
export function parseEmbeddingRequest(path, body) {
    const action = Object.entries(VECTOR_PATHS).find(([suffix]) => path.endsWith(suffix))?.[1];
    if (!action || !body || typeof body !== 'object') return null;
    // WebLLM / KoboldCpp vectors are computed before the request and sent along as { text: vector }
    if (body.embeddings && typeof body.embeddings === 'object' && Object.keys(body.embeddings).length) return null;

    const source = String(body.source || '');
    let texts = [];
    if (action === 'insert') {
        texts = Array.isArray(body.items) ? body.items.map(item => (typeof item?.text === 'string' ? item.text : '')) : [];
    } else if (typeof body.searchText === 'string') {
        texts = [body.searchText];
    }
    texts = texts.filter(text => text.length > 0);
    if (!source || !texts.length) return null;

    const model = (typeof body.model === 'string' && body.model) ? body.model : (DEFAULT_MODELS[source] || null);
    return { action, source, model, texts };
}

/**
 * True when the model uses OpenAI's cl100k tokenizer, so the local count matches the bill exactly.
 * @param {string|null} model
 */
export function isOpenAiEmbeddingModel(model) {
    return /(^|\/)text-embedding-(3-small|3-large|ada-002)$/i.test(String(model || ''));
}

/**
 * Turns the result of SillyTavern's `/api/tokenizers/openai/count` (every text sent as a separate
 * message) back into the plain sum of tokens: that endpoint adds 3 tokens per message and 3 at the end.
 * @param {number} counted
 * @param {number} messages
 */
export function stripMessageOverhead(counted, messages) {
    return Math.max(0, counted - 3 * messages - 3);
}
