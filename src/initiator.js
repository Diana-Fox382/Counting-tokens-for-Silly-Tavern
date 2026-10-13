/**
 * Finds out which extension sent a request: its scripts are on the call stack
 * (`/scripts/extensions/<name>/` or `/scripts/extensions/third-party/<name>/`).
 * Pure module, no SillyTavern dependencies.
 */

const EXTENSION_FRAME = /\/scripts\/extensions\/(third-party\/)?([^/?#:\s)]+)\//g;

function decode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Folder of this extension, taken from a module URL, so it can be left out of the results.
 * @param {string} moduleUrl `import.meta.url` of one of the extension modules
 * @returns {string|null}
 */
export function ownExtensionFolder(moduleUrl) {
    const match = /\/scripts\/extensions\/(?:third-party\/)?([^/]+)\//.exec(String(moduleUrl || ''));
    return match ? decode(match[1]) : null;
}

/**
 * Extensions found on a stack trace, from the one that started the call to the closest one.
 * Built-in extensions are returned by folder name (`memory`), third-party ones as `third-party/<folder>`.
 * @param {string} stack `Error().stack`
 * @param {string|null} [ownFolder] Folder to ignore (this extension)
 * @returns {string[]}
 */
export function extensionsFromStack(stack, ownFolder = null) {
    const names = [];
    for (const match of String(stack || '').matchAll(EXTENSION_FRAME)) {
        const folder = decode(match[2]);
        if (ownFolder && folder === ownFolder) continue;
        const name = match[1] ? `third-party/${folder}` : folder;
        if (!names.includes(name)) names.push(name);
    }
    // The stack lists the innermost call first: the originator is the last one
    return names.reverse();
}

/**
 * Captures the current call stack with enough frames to reach the calling extension.
 * @returns {string}
 */
export function captureStack() {
    const previous = Error.stackTraceLimit;
    try {
        Error.stackTraceLimit = 60;
        return String(new Error().stack || '');
    } catch {
        return '';
    } finally {
        Error.stackTraceLimit = previous;
    }
}
