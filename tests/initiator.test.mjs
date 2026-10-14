import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extensionsFromStack, ownExtensionFolder } from '../src/initiator.js';

// Shape of a real Chrome stack trace with async frames
const stack = `Error
    at captureStack (http://host:8000/scripts/extensions/third-party/Counting-tokens-for-Silly-Tavern/src/initiator.js:52:23)
    at window.fetch (http://host:8000/scripts/extensions/third-party/Counting-tokens-for-Silly-Tavern/src/interceptor.js:190:39)
    at window.fetch (http://host:8000/scripts/extensions/third-party/ST-Meddler/index.js:10:5)
    at sendOpenAIRequest (http://host:8000/scripts/openai.js:3149:28)
    at async Generate (http://host:8000/script.js:4520:13)
    at async generateQuietPrompt (http://host:8000/script.js:3410:20)
    at async buildChoices (http://host:8000/scripts/extensions/third-party/Choice%20Tree%20UI/index.js:120:9)
    at async http://host:8000/scripts/extensions/third-party/Choice%20Tree%20UI/index.js:300:5`;

test('own folder is detected from the module URL', () => {
    assert.equal(ownExtensionFolder('http://host:8000/scripts/extensions/third-party/Counting-tokens-for-Silly-Tavern/src/interceptor.js'), 'Counting-tokens-for-Silly-Tavern');
    assert.equal(ownExtensionFolder('http://host:8000/scripts/extensions/token-wallet/src/interceptor.js'), 'token-wallet');
});

test('the originating extension comes first, this extension is ignored', () => {
    assert.deepEqual(
        extensionsFromStack(stack, 'Counting-tokens-for-Silly-Tavern'),
        ['third-party/Choice Tree UI', 'third-party/ST-Meddler'],
    );
});

test('built-in extensions and core requests', () => {
    const summarize = 'Error\n    at async summarizeChatMain (http://host/scripts/extensions/memory/index.js:610:22)\n    at http://host/scripts/extensions.js:900:1';
    assert.deepEqual(extensionsFromStack(summarize), ['memory']);
    const core = 'Error\n    at sendOpenAIRequest (http://host/scripts/openai.js:1:1)\n    at async Generate (http://host/script.js:1:1)';
    assert.deepEqual(extensionsFromStack(core), []);
});
