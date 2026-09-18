import { buildHeaders } from "./headers.mjs";
import { ReadableStreamFrom, ReadableStreamToAsyncIterable } from "./shims.mjs";
import { encodeUTF8 } from "./utils/bytes.mjs";
const brand_privateStreamingFile = /* @__PURE__ */ Symbol('brand.privateStreamingFile');
/**
 * Wrap a stream as an uploadable file without reading it into memory.
 *
 * Unlike {@link toFile}, this helper does not create a web `File`, because the `File` constructor
 * must consume all of its contents up front. The stream is instead encoded lazily as multipart
 * form data when the request is sent.
 */
export function toStreamingFile(data, name, options) {
    if (!name) {
        throw new TypeError('toStreamingFile requires a non-empty file name');
    }
    return {
        [brand_privateStreamingFile]: true,
        data,
        name,
        ...(options?.type ? { type: options.type } : {}),
    };
}
export const checkFileSupport = () => {
    if (typeof File === 'undefined') {
        const { process } = globalThis;
        const isOldNode = typeof process?.versions?.node === 'string' && parseInt(process.versions.node.split('.')) < 20;
        throw new Error('`File` is not defined as a global, which is required for file uploads.' +
            (isOldNode ?
                " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`."
                : ''));
    }
};
/**
 * Construct a `File` instance. This is used to ensure a helpful error is thrown
 * for environments that don't define a global `File` yet.
 */
export function makeFile(fileBits, fileName, options) {
    checkFileSupport();
    return new File(fileBits, fileName ?? 'unknown_file', options);
}
export function getName(value) {
    return (((typeof value === 'object' &&
        value !== null &&
        (('name' in value && value.name && String(value.name)) ||
            ('url' in value && value.url && String(value.url)) ||
            ('filename' in value && value.filename && String(value.filename)) ||
            ('path' in value && value.path && String(value.path)))) ||
        '')
        .split(/[\\/]/)
        .pop() || undefined);
}
export const isAsyncIterable = (value) => value != null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function';
/**
 * Returns a multipart/form-data request if any part of the given request body contains a File / Blob value.
 * Otherwise returns the request as is.
 */
export const maybeMultipartFormRequestOptions = async (opts, fetch) => {
    if (!hasUploadableValue(opts.body))
        return opts;
    if (hasStreamingUploadableValue(opts.body)) {
        return createStreamingFormRequestOptions(opts);
    }
    return { ...opts, body: await createForm(opts.body, fetch) };
};
export const multipartFormRequestOptions = async (opts, fetch) => {
    if (hasStreamingUploadableValue(opts.body)) {
        return createStreamingFormRequestOptions(opts);
    }
    return { ...opts, body: await createForm(opts.body, fetch) };
};
const supportsFormDataMap = /* @__PURE__ */ new WeakMap();
/**
 * node-fetch doesn't support the global FormData object in recent node versions. Instead of sending
 * properly-encoded form data, it just stringifies the object, resulting in a request body of "[object FormData]".
 * This function detects if the fetch function provided supports the global FormData object to avoid
 * confusing error messages later on.
 */
function supportsFormData(fetchObject) {
    const fetch = typeof fetchObject === 'function' ? fetchObject : fetchObject.fetch;
    const cached = supportsFormDataMap.get(fetch);
    if (cached)
        return cached;
    const promise = (async () => {
        try {
            const FetchResponse = ('Response' in fetch ?
                fetch.Response
                : (await fetch('data:,')).constructor);
            const data = new FormData();
            if (data.toString() === (await new FetchResponse(data).text())) {
                return false;
            }
            return true;
        }
        catch {
            // avoid false negatives
            return true;
        }
    })();
    supportsFormDataMap.set(fetch, promise);
    return promise;
}
export const createForm = async (body, fetch) => {
    if (!(await supportsFormData(fetch))) {
        throw new TypeError('The provided fetch function does not support file uploads with the current global FormData class.');
    }
    const form = new FormData();
    await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
    return form;
};
// We check for Blob not File because Bun.File doesn't inherit from File,
// but they both inherit from Blob and have a `name` property at runtime.
const isNamedBlob = (value) => value instanceof Blob && 'name' in value;
const isReadableStream = (value) => typeof value === 'object' &&
    value !== null &&
    'getReader' in value &&
    typeof value.getReader === 'function';
const isStreamingFile = (value) => typeof value === 'object' && value !== null && brand_privateStreamingFile in value;
const isUploadable = (value) => typeof value === 'object' &&
    value !== null &&
    (value instanceof Response ||
        isAsyncIterable(value) ||
        isReadableStream(value) ||
        isStreamingFile(value) ||
        isNamedBlob(value));
const hasStreamingUploadableValue = (value) => {
    if (isStreamingFile(value) || isAsyncIterable(value) || isReadableStream(value))
        return true;
    if (Array.isArray(value))
        return value.some(hasStreamingUploadableValue);
    if (value && typeof value === 'object' && !isNamedBlob(value) && !(value instanceof Response)) {
        for (const k in value) {
            if (hasStreamingUploadableValue(value[k]))
                return true;
        }
    }
    return false;
};
const hasUploadableValue = (value) => {
    if (isUploadable(value))
        return true;
    if (Array.isArray(value))
        return value.some(hasUploadableValue);
    if (value && typeof value === 'object') {
        for (const k in value) {
            if (hasUploadableValue(value[k]))
                return true;
        }
    }
    return false;
};
const createStreamingFormRequestOptions = (opts) => {
    const boundary = `openai-${Math.random().toString(36).slice(2)}`;
    const body = ReadableStreamFrom(iterateMultipartBody(opts.body, boundary));
    return {
        ...opts,
        body,
        headers: buildHeaders([{ 'content-type': `multipart/form-data; boundary=${boundary}` }, opts.headers]),
    };
};
async function* iterateMultipartBody(body, boundary) {
    for await (const { key, value } of iterateFormEntries(body)) {
        yield encodeUTF8(`--${boundary}\r\n`);
        if (isUploadable(value)) {
            const filename = getStreamingFileName(value);
            const type = getStreamingFileType(value);
            yield encodeUTF8(`Content-Disposition: form-data; name="${escapeHeaderValue(key)}"; filename="${escapeHeaderValue(filename)}"\r\n` + `Content-Type: ${type}\r\n\r\n`);
            yield* iterateBytes(getStreamingFileData(value));
        }
        else {
            yield encodeUTF8(`Content-Disposition: form-data; name="${escapeHeaderValue(key)}"\r\n\r\n${String(value)}`);
        }
        yield encodeUTF8('\r\n');
    }
    yield encodeUTF8(`--${boundary}--\r\n`);
}
async function* iterateFormEntries(body) {
    if (!body || typeof body !== 'object')
        return;
    for (const [key, value] of Object.entries(body)) {
        yield* iterateFormValue(key, value);
    }
}
async function* iterateFormValue(key, value) {
    if (value === undefined)
        return;
    if (value == null) {
        throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
    }
    if (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        isUploadable(value)) {
        yield { key, value };
    }
    else if (Array.isArray(value)) {
        for (const entry of value) {
            yield* iterateFormValue(key + '[]', entry);
        }
    }
    else if (typeof value === 'object') {
        for (const [name, prop] of Object.entries(value)) {
            yield* iterateFormValue(`${key}[${name}]`, prop);
        }
    }
    else {
        throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
    }
}
function getStreamingFileName(value) {
    return isStreamingFile(value) ? value.name : getName(value) ?? 'unknown_file';
}
function getStreamingFileType(value) {
    if (isStreamingFile(value))
        return value.type || 'application/octet-stream';
    if (isNamedBlob(value) && value.type)
        return value.type;
    if (value instanceof Response)
        return value.headers.get('content-type') || 'application/octet-stream';
    return 'application/octet-stream';
}
function getStreamingFileData(value) {
    if (isStreamingFile(value))
        return value.data;
    return value;
}
async function* iterateBytes(value) {
    if (typeof value === 'string') {
        yield encodeUTF8(value);
    }
    else if (ArrayBuffer.isView(value)) {
        yield new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    else if (value instanceof ArrayBuffer) {
        yield new Uint8Array(value);
    }
    else if (value instanceof Response) {
        if (value.body) {
            yield* iterateBytes(value.body);
        }
        else {
            yield* iterateBytes(await value.blob());
        }
    }
    else if (value instanceof Blob) {
        if (typeof value.stream === 'function') {
            yield* iterateBytes(value.stream());
        }
        else {
            yield new Uint8Array(await value.arrayBuffer());
        }
    }
    else if (isReadableStream(value)) {
        for await (const chunk of ReadableStreamToAsyncIterable(value)) {
            yield* iterateBytes(chunk);
        }
    }
    else if (isAsyncIterable(value)) {
        for await (const chunk of value) {
            yield* iterateBytes(chunk);
        }
    }
    else {
        throw new TypeError(`Invalid streaming file chunk: ${String(value)}`);
    }
}
function escapeHeaderValue(value) {
    return value.replace(/["\\\r\n]/g, (character) => encodeURIComponent(character));
}
const addFormValue = async (form, key, value) => {
    if (value === undefined)
        return;
    if (value == null) {
        throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
    }
    // TODO: make nested formats configurable
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        form.append(key, String(value));
    }
    else if (value instanceof Response) {
        form.append(key, makeFile([await value.blob()], getName(value)));
    }
    else if (isAsyncIterable(value)) {
        form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value)));
    }
    else if (isNamedBlob(value)) {
        form.append(key, value, getName(value));
    }
    else if (Array.isArray(value)) {
        await Promise.all(value.map((entry) => addFormValue(form, key + '[]', entry)));
    }
    else if (typeof value === 'object') {
        await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
    }
    else {
        throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
    }
};
//# sourceMappingURL=uploads.mjs.map