import { t as X_ALREADY_SENT } from "./constants-BLSFu_RU.mjs";
import { STATUS_CODES, createServer } from "node:http";
import { Http2ServerRequest, constants } from "node:http2";
import { Readable } from "node:stream";
import { defineWebSocketHelper } from "hono/ws";

//#region src/error.ts
var RequestError = class extends Error {
	constructor(message, options) {
		super(message, options);
		this.name = "RequestError";
	}
};

//#endregion
//#region src/url.ts
const reValidRequestUrl = /^\/[!#$&-;=?-\[\]_a-z~]*$/;
const reDotSegment = /\/\.\.?(?:[/?#]|$)/;
const reValidHost = /^[a-z0-9._-]+(?::(?:[1-5]\d{3,4}|[6-9]\d{3}))?$/;
const buildUrl = (scheme, host, incomingUrl) => {
	const url = `${scheme}://${host}${incomingUrl}`;
	if (!reValidHost.test(host)) {
		const urlObj = new URL(url);
		if (urlObj.hostname.length !== host.length && urlObj.hostname !== (host.includes(":") ? host.replace(/:\d+$/, "") : host).toLowerCase()) throw new RequestError("Invalid host header");
		return urlObj.href;
	} else if (incomingUrl.length === 0) return url + "/";
	else {
		if (incomingUrl.charCodeAt(0) !== 47) throw new RequestError("Invalid URL");
		if (!reValidRequestUrl.test(incomingUrl) || reDotSegment.test(incomingUrl)) return new URL(url).href;
		return url;
	}
};

//#endregion
//#region src/request.ts
const toRequestError = (e) => {
	if (e instanceof RequestError) return e;
	return new RequestError(e.message, { cause: e });
};
const GlobalRequest = global.Request;
var Request$1 = class extends GlobalRequest {
	constructor(input, options) {
		if (typeof input === "object" && getRequestCache in input) {
			const hasReplacementBody = options !== void 0 && "body" in options && options.body != null;
			if (input[bodyConsumedDirectlyKey] && !hasReplacementBody) throw new TypeError("Cannot construct a Request with a Request object that has already been used.");
			input = input[getRequestCache]();
		}
		if (typeof (options?.body)?.getReader !== "undefined") options.duplex ??= "half";
		super(input, options);
	}
};
const newHeadersFromIncoming = (incoming) => {
	const headerRecord = [];
	const rawHeaders = incoming.rawHeaders;
	for (let i = 0, len = rawHeaders.length; i < len; i += 2) {
		const key = rawHeaders[i];
		if (key.charCodeAt(0) !== 58) headerRecord.push([key, rawHeaders[i + 1]]);
	}
	return new Headers(headerRecord);
};
const wrapBodyStream = Symbol("wrapBodyStream");
const byteExactEncodings = new Set([
	"latin1",
	"binary",
	"hex",
	"base64",
	"base64url"
]);
const isByteExactEncoding = (encoding) => encoding === null || byteExactEncodings.has(encoding);
const bodyBufferedBeforeDisconnectKey = Symbol("bodyBufferedBeforeDisconnect");
const bodyBufferedLengthBeforeDisconnectKey = Symbol("bodyBufferedLengthBeforeDisconnect");
const toBufferChunk = (chunk, encoding) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding ?? "utf8");
const isRecoverableDisconnectedIncoming = (incoming) => !(incoming instanceof Http2ServerRequest) && !!incoming.complete && !!incoming.readableAborted && typeof incoming.read === "function" && isByteExactEncoding(incoming.readableEncoding);
const recordBodyBufferedBeforeDisconnect = (incoming) => {
	if (incoming.readableDidRead || !isRecoverableDisconnectedIncoming(incoming)) return;
	const incomingWithRecovery = incoming;
	incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] ??= incoming.readableLength;
};
const readBodyBufferedBeforeDisconnect = (incoming, chunks) => {
	if (incoming.readableDidRead && !chunks || !isRecoverableDisconnectedIncoming(incoming)) return;
	const incomingWithRecovery = incoming;
	if (incomingWithRecovery[bodyBufferedBeforeDisconnectKey] !== void 0) return incomingWithRecovery[bodyBufferedBeforeDisconnectKey];
	let result;
	const errored = incoming.errored;
	if (errored && errored.code !== "ECONNRESET") result = errored;
	else if (incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] !== void 0 && incoming.readableLength !== incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey]) result = newBodyUnusableError();
	else {
		const bodyChunks = chunks ?? [];
		const chunk = incoming.read();
		if (chunk !== null) bodyChunks.push(toBufferChunk(chunk, incoming.readableEncoding));
		const buffer = bodyChunks.length === 1 ? bodyChunks[0] : Buffer.concat(bodyChunks);
		result = buffer;
		const contentLength = incoming.headers["content-length"];
		if (typeof contentLength === "string" && /^\d+$/.test(contentLength)) {
			const expectedLength = Number(contentLength);
			if (Number.isSafeInteger(expectedLength) && buffer.length !== expectedLength) result = newBodyUnusableError();
		}
	}
	incomingWithRecovery[bodyBufferedBeforeDisconnectKey] = result;
	return result;
};
const enqueueBufferedBody = (controller, buffered) => {
	if (buffered instanceof Error) {
		controller.error(buffered);
		return;
	}
	if (buffered.length > 0) controller.enqueue(buffered);
	controller.close();
};
const newRequestFromIncoming = (method, url, headers, incoming, abortController) => {
	const init = {
		method,
		headers,
		signal: abortController.signal
	};
	if (method === "TRACE") {
		init.method = "GET";
		const req = new Request$1(url, init);
		Object.defineProperty(req, "method", { get() {
			return "TRACE";
		} });
		return req;
	}
	if (!(method === "GET" || method === "HEAD")) if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) init.body = new ReadableStream({ start(controller) {
		controller.enqueue(incoming.rawBody);
		controller.close();
	} });
	else if (incoming[wrapBodyStream]) {
		let reader;
		init.body = new ReadableStream({ async pull(controller) {
			try {
				if (!reader) {
					const buffered = readBodyBufferedBeforeDisconnect(incoming);
					if (buffered !== void 0) {
						enqueueBufferedBody(controller, buffered);
						return;
					}
				}
				reader ||= Readable.toWeb(incoming).getReader();
				const { done, value } = await reader.read();
				if (done) controller.close();
				else controller.enqueue(value);
			} catch (error) {
				controller.error(error);
			}
		} });
	} else {
		const buffered = readBodyBufferedBeforeDisconnect(incoming);
		if (buffered !== void 0) init.body = new ReadableStream({ start(controller) {
			enqueueBufferedBody(controller, buffered);
		} });
		else init.body = Readable.toWeb(incoming);
	}
	return new Request$1(url, init);
};
const getRequestCache = Symbol("getRequestCache");
const requestCache = Symbol("requestCache");
const incomingKey = Symbol("incomingKey");
const urlKey = Symbol("urlKey");
const methodKey = Symbol("methodKey");
const headersKey = Symbol("headersKey");
const abortControllerKey = Symbol("abortControllerKey");
const getAbortController = Symbol("getAbortController");
const abortRequest = Symbol("abortRequest");
const bodyBufferKey = Symbol("bodyBuffer");
const bodyReadPromiseKey = Symbol("bodyReadPromise");
const bodyConsumedDirectlyKey = Symbol("bodyConsumedDirectly");
const bodyLockReaderKey = Symbol("bodyLockReader");
const abortReasonKey = Symbol("abortReason");
const newBodyUnusableError = () => {
	return /* @__PURE__ */ new TypeError("Body is unusable");
};
const rejectBodyUnusable = () => {
	return Promise.reject(newBodyUnusableError());
};
const textDecoder = new TextDecoder();
const consumeBodyDirectOnce = (request) => {
	if (request[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	request[bodyConsumedDirectlyKey] = true;
};
const toArrayBuffer = (buf) => {
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const contentType = (request) => {
	return (request[headersKey] ||= newHeadersFromIncoming(request[incomingKey])).get("content-type") || "";
};
const methodTokenRegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const normalizeIncomingMethod = (method) => {
	if (typeof method !== "string" || method.length === 0) return "GET";
	switch (method) {
		case "DELETE":
		case "GET":
		case "HEAD":
		case "OPTIONS":
		case "POST":
		case "PUT": return method;
	}
	const upper = method.toUpperCase();
	switch (upper) {
		case "DELETE":
		case "GET":
		case "HEAD":
		case "OPTIONS":
		case "POST":
		case "PUT": return upper;
		default: return method;
	}
};
const validateDirectReadMethod = (method) => {
	if (!methodTokenRegExp.test(method)) return /* @__PURE__ */ new TypeError(`'${method}' is not a valid HTTP method.`);
	const normalized = method.toUpperCase();
	if (normalized === "CONNECT" || normalized === "TRACK" || normalized === "TRACE" && method !== "TRACE") return /* @__PURE__ */ new TypeError(`'${method}' HTTP method is unsupported.`);
};
const readBodyWithFastPath = (request, method, fromBuffer) => {
	if (request[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	const methodName = request.method;
	if (methodName === "GET" || methodName === "HEAD") return request[getRequestCache]()[method]();
	const methodValidationError = validateDirectReadMethod(methodName);
	if (methodValidationError) return Promise.reject(methodValidationError);
	if (request[requestCache]) {
		if (methodName !== "TRACE") return request[requestCache][method]();
	}
	const alreadyUsedError = consumeBodyDirectOnce(request);
	if (alreadyUsedError) return alreadyUsedError;
	const raw = readRawBodyIfAvailable(request);
	if (raw) {
		const result = Promise.resolve(fromBuffer(raw, request));
		request[bodyBufferKey] = void 0;
		return result;
	}
	return readBodyDirect(request).then((buf) => {
		const result = fromBuffer(buf, request);
		request[bodyBufferKey] = void 0;
		return result;
	});
};
const readRawBodyIfAvailable = (request) => {
	const incoming = request[incomingKey];
	if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) return incoming.rawBody;
};
const normalizeAbortError = (request, incoming) => {
	if (incoming.errored) return incoming.errored;
	const reason = request[abortReasonKey];
	if (reason !== void 0) return reason instanceof Error ? reason : new Error(String(reason));
	return /* @__PURE__ */ new Error("Client connection prematurely closed.");
};
const readBodyDirect = (request) => {
	if (request[bodyBufferKey]) return Promise.resolve(request[bodyBufferKey]);
	if (request[bodyReadPromiseKey]) return request[bodyReadPromiseKey];
	const incoming = request[incomingKey];
	if (incoming.readableDidRead) return rejectBodyUnusable();
	const buffered = readBodyBufferedBeforeDisconnect(incoming);
	if (buffered !== void 0) {
		if (buffered instanceof Error) return Promise.reject(buffered);
		request[bodyBufferKey] = buffered;
		return Promise.resolve(buffered);
	}
	const promise = new Promise((resolve, reject) => {
		const chunks = [];
		let settled = false;
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const recoverCompleteBodyAfterDisconnect = (error) => {
			const streamError = incoming.errored ?? error;
			if (!isRecoverableDisconnectedIncoming(incoming) || streamError && streamError.code !== "ECONNRESET") return false;
			finish(() => {
				const recovered = readBodyBufferedBeforeDisconnect(incoming, chunks);
				if (recovered instanceof Error) reject(recovered);
				else if (recovered === void 0) reject(error ?? normalizeAbortError(request, incoming));
				else {
					request[bodyBufferKey] = recovered;
					resolve(recovered);
				}
			});
			return true;
		};
		const onData = (chunk) => {
			chunks.push(toBufferChunk(chunk, incoming.readableEncoding));
		};
		const onEnd = () => {
			finish(() => {
				const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
				request[bodyBufferKey] = buffer;
				resolve(buffer);
			});
		};
		const onError = (error) => {
			if (recoverCompleteBodyAfterDisconnect(error)) return;
			finish(() => {
				reject(error);
			});
		};
		const onClose = () => {
			if (incoming.readableEnded) {
				onEnd();
				return;
			}
			if (recoverCompleteBodyAfterDisconnect()) return;
			finish(() => {
				reject(normalizeAbortError(request, incoming));
			});
		};
		const cleanup = () => {
			incoming.off("data", onData);
			incoming.off("end", onEnd);
			incoming.off("error", onError);
			incoming.off("close", onClose);
			request[bodyReadPromiseKey] = void 0;
		};
		incoming.on("data", onData);
		incoming.on("end", onEnd);
		incoming.on("error", onError);
		incoming.on("close", onClose);
		queueMicrotask(() => {
			if (settled) return;
			if (incoming.readableEnded) onEnd();
			else if (incoming.errored) onError(incoming.errored);
			else if (incoming.destroyed) onClose();
		});
	});
	request[bodyReadPromiseKey] = promise;
	return promise;
};
const requestPrototype = {
	get method() {
		return this[methodKey];
	},
	get url() {
		return this[urlKey];
	},
	get headers() {
		return this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]);
	},
	[abortRequest](reason) {
		if (this[abortReasonKey] === void 0) this[abortReasonKey] = reason;
		const abortController = this[abortControllerKey];
		if (abortController && !abortController.signal.aborted) abortController.abort(reason);
	},
	[getAbortController]() {
		this[abortControllerKey] ||= new AbortController();
		if (this[abortReasonKey] !== void 0 && !this[abortControllerKey].signal.aborted) this[abortControllerKey].abort(this[abortReasonKey]);
		return this[abortControllerKey];
	},
	[getRequestCache]() {
		const abortController = this[getAbortController]();
		if (this[requestCache]) return this[requestCache];
		const method = this.method;
		if (this[bodyConsumedDirectlyKey] && !(method === "GET" || method === "HEAD")) {
			this[bodyBufferKey] = void 0;
			const init = {
				method: method === "TRACE" ? "GET" : method,
				headers: this.headers,
				signal: abortController.signal
			};
			if (method !== "TRACE") {
				init.body = new ReadableStream({ start(c) {
					c.close();
				} });
				init.duplex = "half";
			}
			const req = new Request$1(this[urlKey], init);
			if (method === "TRACE") Object.defineProperty(req, "method", { get() {
				return "TRACE";
			} });
			return this[requestCache] = req;
		}
		return this[requestCache] = newRequestFromIncoming(this.method, this[urlKey], this.headers, this[incomingKey], abortController);
	},
	get body() {
		if (!this[bodyConsumedDirectlyKey]) return this[getRequestCache]().body;
		const request = this[getRequestCache]();
		if (!this[bodyLockReaderKey] && request.body) this[bodyLockReaderKey] = request.body.getReader();
		return request.body;
	},
	get bodyUsed() {
		if (this[bodyConsumedDirectlyKey]) return true;
		if (this[requestCache]) return this[requestCache].bodyUsed;
		return false;
	}
};
Object.defineProperty(requestPrototype, "signal", { get() {
	return this[getAbortController]().signal;
} });
[
	"cache",
	"credentials",
	"destination",
	"integrity",
	"mode",
	"redirect",
	"referrer",
	"referrerPolicy",
	"keepalive"
].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { get() {
		return this[getRequestCache]()[k];
	} });
});
["clone", "formData"].forEach((k) => {
	Object.defineProperty(requestPrototype, k, { value: function() {
		if (this[bodyConsumedDirectlyKey]) {
			if (k === "clone") throw newBodyUnusableError();
			return rejectBodyUnusable();
		}
		return this[getRequestCache]()[k]();
	} });
});
Object.defineProperty(requestPrototype, "text", { value: function() {
	return readBodyWithFastPath(this, "text", (buf) => textDecoder.decode(buf));
} });
Object.defineProperty(requestPrototype, "arrayBuffer", { value: function() {
	return readBodyWithFastPath(this, "arrayBuffer", (buf) => toArrayBuffer(buf));
} });
Object.defineProperty(requestPrototype, "blob", { value: function() {
	return readBodyWithFastPath(this, "blob", (buf, request) => {
		const type = contentType(request);
		const init = type ? { headers: { "content-type": type } } : void 0;
		return new Response(buf, init).blob();
	});
} });
Object.defineProperty(requestPrototype, "json", { value: function() {
	if (this[bodyConsumedDirectlyKey]) return rejectBodyUnusable();
	return this.text().then(JSON.parse);
} });
Object.defineProperty(requestPrototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Request (lightweight) ${inspectFn({
		method: this.method,
		url: this.url,
		headers: this.headers,
		nativeRequest: this[requestCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(requestPrototype, Request$1.prototype);
const newRequest = (incoming, defaultHostname) => {
	const req = Object.create(requestPrototype);
	req[incomingKey] = incoming;
	req[methodKey] = normalizeIncomingMethod(incoming.method);
	const incomingUrl = incoming.url || "";
	if (incomingUrl[0] !== "/" && (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))) {
		if (incoming instanceof Http2ServerRequest) throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
		try {
			req[urlKey] = new URL(incomingUrl).href;
		} catch (e) {
			throw new RequestError("Invalid absolute URL", { cause: e });
		}
		return req;
	}
	const host = (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) || defaultHostname;
	if (!host) throw new RequestError("Missing host header");
	let scheme;
	if (incoming instanceof Http2ServerRequest) {
		scheme = incoming.scheme;
		if (!(scheme === "http" || scheme === "https")) throw new RequestError("Unsupported scheme");
	} else scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
	try {
		req[urlKey] = buildUrl(scheme, host, incomingUrl);
	} catch (e) {
		if (e instanceof RequestError) throw e;
		else throw new RequestError("Invalid URL", { cause: e });
	}
	return req;
};

//#endregion
//#region src/response.ts
const defaultContentType = "text/plain; charset=UTF-8";
const responseCache = Symbol("responseCache");
const getResponseCache = Symbol("getResponseCache");
const cacheKey = Symbol("cache");
const GlobalResponse = global.Response;
var Response$1 = class Response$1 {
	#body;
	#init;
	[getResponseCache]() {
		const cache = this[cacheKey];
		const liveHeaders = cache && cache[2] instanceof Headers ? cache[2] : void 0;
		delete this[cacheKey];
		return this[responseCache] ||= new GlobalResponse(this.#body, liveHeaders ? {
			status: this.#init?.status,
			statusText: this.#init?.statusText,
			headers: liveHeaders
		} : this.#init);
	}
	constructor(body, init) {
		let headers;
		this.#body = body;
		if (init instanceof Response$1) {
			const cachedGlobalResponse = init[responseCache];
			if (cachedGlobalResponse) {
				this.#init = cachedGlobalResponse;
				this[getResponseCache]();
				return;
			} else {
				this.#init = init.#init;
				headers = new Headers(init.headers);
			}
		} else this.#init = init;
		if (body == null || typeof body === "string" || typeof body?.getReader !== "undefined" || body instanceof Blob || body instanceof Uint8Array) this[cacheKey] = [
			init?.status || 200,
			body ?? null,
			headers || init?.headers
		];
	}
	get headers() {
		const cache = this[cacheKey];
		if (cache) {
			if (!(cache[2] instanceof Headers)) cache[2] = new Headers(cache[2] || (cache[1] === null ? void 0 : { "content-type": defaultContentType }));
			return cache[2];
		}
		return this[getResponseCache]().headers;
	}
	get status() {
		return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
	}
	get ok() {
		const status = this.status;
		return status >= 200 && status < 300;
	}
};
[
	"body",
	"bodyUsed",
	"redirected",
	"statusText",
	"trailers",
	"type",
	"url"
].forEach((k) => {
	Object.defineProperty(Response$1.prototype, k, { get() {
		return this[getResponseCache]()[k];
	} });
});
[
	"arrayBuffer",
	"blob",
	"clone",
	"formData",
	"json",
	"text"
].forEach((k) => {
	Object.defineProperty(Response$1.prototype, k, { value: function() {
		return this[getResponseCache]()[k]();
	} });
});
Object.defineProperty(Response$1.prototype, Symbol.for("nodejs.util.inspect.custom"), { value: function(depth, options, inspectFn) {
	return `Response (lightweight) ${inspectFn({
		status: this.status,
		headers: this.headers,
		ok: this.ok,
		nativeResponse: this[responseCache]
	}, {
		...options,
		depth: depth == null ? null : depth - 1
	})}`;
} });
Object.setPrototypeOf(Response$1, GlobalResponse);
Object.setPrototypeOf(Response$1.prototype, GlobalResponse.prototype);
const validRedirectUrl = /^https?:\/\/[!#-;=?-[\]_a-z~A-Z]+$/;
const parseRedirectUrl = (url) => {
	if (url instanceof URL) return url.href;
	if (validRedirectUrl.test(url)) return url;
	return new URL(url).href;
};
const validRedirectStatuses = new Set([
	301,
	302,
	303,
	307,
	308
]);
Object.defineProperty(Response$1, "redirect", {
	value: function redirect(url, status = 302) {
		if (!validRedirectStatuses.has(status)) throw new RangeError("Invalid status code");
		return new Response$1(null, {
			status,
			headers: { location: parseRedirectUrl(url) }
		});
	},
	writable: true,
	configurable: true
});
Object.defineProperty(Response$1, "json", {
	value: function json(data, init) {
		const body = JSON.stringify(data);
		if (body === void 0) throw new TypeError("The data is not JSON serializable");
		const initHeaders = init?.headers;
		let headers;
		if (initHeaders) {
			headers = new Headers(initHeaders);
			if (!headers.has("content-type")) headers.set("content-type", "application/json");
		} else headers = { "content-type": "application/json" };
		return new Response$1(body, {
			status: init?.status ?? 200,
			statusText: init?.statusText,
			headers
		});
	},
	writable: true,
	configurable: true
});

//#endregion
//#region src/utils.ts
async function readWithoutBlocking(readPromise) {
	return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise) {
	const cancel = (error) => {
		reader.cancel(error).catch(() => {});
	};
	writable.on("close", cancel);
	writable.on("error", cancel);
	(currentReadPromise ?? reader.read()).then(flow, handleStreamError);
	return reader.closed.finally(() => {
		writable.off("close", cancel);
		writable.off("error", cancel);
	});
	function handleStreamError(error) {
		if (error) writable.destroy(error);
	}
	function onDrain() {
		reader.read().then(flow, handleStreamError);
	}
	function flow({ done, value }) {
		try {
			if (done) writable.end();
			else if (!writable.write(value)) writable.once("drain", onDrain);
			else return reader.read().then(flow, handleStreamError);
		} catch (e) {
			handleStreamError(e);
		}
	}
}
function writeFromReadableStream(stream, writable) {
	if (stream.locked) throw new TypeError("ReadableStream is locked.");
	else if (writable.destroyed) return;
	return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
const buildOutgoingHttpHeaders = (headers, defaultContentType) => {
	const res = {};
	if (!(headers instanceof Headers)) headers = new Headers(headers ?? void 0);
	if (headers.has("set-cookie")) {
		const cookies = [];
		for (const [k, v] of headers) if (k === "set-cookie") cookies.push(v);
		else res[k] = v;
		if (cookies.length > 0) res["set-cookie"] = cookies;
	} else for (const [k, v] of headers) res[k] = v;
	if (defaultContentType) res["content-type"] ??= defaultContentType;
	return res;
};

//#endregion
//#region src/listener.ts
const outgoingEnded = Symbol("outgoingEnded");
const incomingDraining = Symbol("incomingDraining");
const DRAIN_TIMEOUT_MS = 500;
const MAX_DRAIN_BYTES = 64 * 1024 * 1024;
const drainIncoming = (incoming) => {
	const incomingWithDrainState = incoming;
	if (incoming.destroyed || incomingWithDrainState[incomingDraining]) return;
	incomingWithDrainState[incomingDraining] = true;
	if (incoming instanceof Http2ServerRequest) {
		try {
			incoming.stream?.close?.(constants.NGHTTP2_NO_ERROR);
		} catch {}
		return;
	}
	let bytesRead = 0;
	const cleanup = () => {
		clearTimeout(timer);
		incoming.off("data", onData);
		incoming.off("end", cleanup);
		incoming.off("error", cleanup);
	};
	const forceClose = () => {
		cleanup();
		const socket = incoming.socket;
		if (socket && !socket.destroyed) socket.destroySoon();
	};
	const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS);
	timer.unref?.();
	const onData = (chunk) => {
		bytesRead += chunk.length;
		if (bytesRead > MAX_DRAIN_BYTES) forceClose();
	};
	incoming.on("data", onData);
	incoming.on("end", cleanup);
	incoming.on("error", cleanup);
	incoming.resume();
};
const makeCloseHandler = (req, incoming, outgoing, needsBodyCleanup) => () => {
	if (incoming.errored) {
		recordBodyBufferedBeforeDisconnect(incoming);
		req[abortRequest](incoming.errored.toString());
	} else if (!outgoing.writableFinished) {
		recordBodyBufferedBeforeDisconnect(incoming);
		req[abortRequest]("Client connection prematurely closed.");
	}
	if (needsBodyCleanup && !incoming.readableEnded) setTimeout(() => {
		if (!incoming.readableEnded) setTimeout(() => {
			drainIncoming(incoming);
		});
	});
};
const isImmediateCacheableResponse = (res) => {
	if (!(cacheKey in res)) return false;
	const body = res[cacheKey][1];
	return body === null || typeof body === "string" || body instanceof Uint8Array;
};
const handleRequestError = () => new Response(null, { status: 400 });
const handleFetchError = (e) => new Response(null, { status: e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError") ? 504 : 500 });
const handleResponseError = (e, outgoing) => {
	const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
	if (err.code === "ERR_STREAM_PREMATURE_CLOSE") console.info("The user aborted a request.");
	else {
		console.error(e);
		if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "text/plain" });
		outgoing.end(`Error: ${err.message}`);
		outgoing.destroy(err);
	}
};
const flushHeaders = (outgoing) => {
	if ("flushHeaders" in outgoing && outgoing.writable) outgoing.flushHeaders();
};
const responseViaCache = async (res, outgoing) => {
	let [status, body, header] = res[cacheKey];
	if (!header) {
		if (body === null) {
			outgoing.writeHead(status);
			outgoing.end();
		} else if (typeof body === "string") {
			outgoing.writeHead(status, {
				"Content-Type": defaultContentType,
				"Content-Length": Buffer.byteLength(body)
			});
			outgoing.end(body);
		} else if (body instanceof Uint8Array) {
			outgoing.writeHead(status, {
				"Content-Type": defaultContentType,
				"Content-Length": body.byteLength
			});
			outgoing.end(body);
		} else if (body instanceof Blob) {
			outgoing.writeHead(status, {
				"Content-Type": defaultContentType,
				"Content-Length": body.size
			});
			outgoing.end(new Uint8Array(await body.arrayBuffer()));
		} else {
			outgoing.writeHead(status, { "Content-Type": defaultContentType });
			flushHeaders(outgoing);
			await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
		}
		outgoing[outgoingEnded]?.();
		return;
	}
	let hasContentLength = false;
	if (header instanceof Headers) {
		hasContentLength = header.has("content-length");
		header = buildOutgoingHttpHeaders(header, body === null ? void 0 : defaultContentType);
	} else if (Array.isArray(header)) {
		const headerObj = new Headers(header);
		hasContentLength = headerObj.has("content-length");
		header = buildOutgoingHttpHeaders(headerObj, body === null ? void 0 : defaultContentType);
	} else for (const key in header) if (key.length === 14 && key.toLowerCase() === "content-length") {
		hasContentLength = true;
		break;
	}
	if (!hasContentLength) {
		if (typeof body === "string") header["Content-Length"] = Buffer.byteLength(body);
		else if (body instanceof Uint8Array) header["Content-Length"] = body.byteLength;
		else if (body instanceof Blob) header["Content-Length"] = body.size;
	}
	outgoing.writeHead(status, header);
	if (body == null) outgoing.end();
	else if (typeof body === "string" || body instanceof Uint8Array) outgoing.end(body);
	else if (body instanceof Blob) outgoing.end(new Uint8Array(await body.arrayBuffer()));
	else {
		flushHeaders(outgoing);
		await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
	}
	outgoing[outgoingEnded]?.();
};
const isPromise = (res) => typeof res.then === "function";
const responseViaResponseObject = async (res, outgoing, options = {}) => {
	if (isPromise(res)) if (options.errorHandler) try {
		res = await res;
	} catch (err) {
		const errRes = await options.errorHandler(err);
		if (!errRes) return;
		res = errRes;
	}
	else res = await res.catch(handleFetchError);
	if (cacheKey in res) return responseViaCache(res, outgoing);
	const resHeaderRecord = buildOutgoingHttpHeaders(res.headers, res.body === null ? void 0 : defaultContentType);
	if (res.body) {
		const reader = res.body.getReader();
		const values = [];
		let done = false;
		let currentReadPromise = void 0;
		if (resHeaderRecord["transfer-encoding"] !== "chunked") {
			let maxReadCount = 2;
			for (let i = 0; i < maxReadCount; i++) {
				currentReadPromise ||= reader.read();
				const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
					console.error(e);
					done = true;
				});
				if (!chunk) {
					if (i === 1) {
						await new Promise((resolve) => setTimeout(resolve));
						maxReadCount = 3;
						continue;
					}
					break;
				}
				currentReadPromise = void 0;
				if (chunk.value) values.push(chunk.value);
				if (chunk.done) {
					done = true;
					break;
				}
			}
			if (done && !("content-length" in resHeaderRecord)) resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
		}
		outgoing.writeHead(res.status, resHeaderRecord);
		values.forEach((value) => {
			outgoing.write(value);
		});
		if (done) outgoing.end();
		else {
			if (values.length === 0) flushHeaders(outgoing);
			await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
		}
	} else if (resHeaderRecord[X_ALREADY_SENT]) {} else {
		outgoing.writeHead(res.status, resHeaderRecord);
		outgoing.end();
	}
	outgoing[outgoingEnded]?.();
};
const getRequestListener = (fetchCallback, options = {}) => {
	const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
	if (options.overrideGlobalObjects !== false && global.Request !== Request$1) {
		Object.defineProperty(global, "Request", { value: Request$1 });
		Object.defineProperty(global, "Response", { value: Response$1 });
	}
	return async (incoming, outgoing) => {
		let res, req;
		let needsBodyCleanup = false;
		let closeHandlerAttached = false;
		const ensureCloseHandler = () => {
			if (!req || closeHandlerAttached) return;
			closeHandlerAttached = true;
			outgoing.on("close", makeCloseHandler(req, incoming, outgoing, needsBodyCleanup));
		};
		try {
			req = newRequest(incoming, options.hostname);
			needsBodyCleanup = autoCleanupIncoming && !(incoming.method === "GET" || incoming.method === "HEAD");
			if (needsBodyCleanup) {
				incoming[wrapBodyStream] = true;
				if (incoming instanceof Http2ServerRequest) outgoing[outgoingEnded] = () => {
					if (!incoming.readableEnded) setTimeout(() => {
						if (!incoming.readableEnded) setTimeout(() => {
							incoming.destroy();
							outgoing.destroy();
						});
					});
				};
			}
			res = fetchCallback(req, {
				incoming,
				outgoing
			});
			if (!isPromise(res) && isImmediateCacheableResponse(res)) {
				if (needsBodyCleanup && !incoming.readableEnded) outgoing.once("finish", () => {
					if (!incoming.readableEnded) drainIncoming(incoming);
				});
				return responseViaCache(res, outgoing);
			}
			ensureCloseHandler();
		} catch (e) {
			if (!res) if (options.errorHandler) {
				ensureCloseHandler();
				res = await options.errorHandler(req ? e : toRequestError(e));
				if (!res) return;
			} else if (!req) res = handleRequestError();
			else res = handleFetchError(e);
			else return handleResponseError(e, outgoing);
		}
		try {
			return await responseViaResponseObject(res, outgoing, options);
		} catch (e) {
			return handleResponseError(e, outgoing);
		}
	};
};

//#endregion
//#region src/websocket.ts
/**
* @link https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
*/
const CloseEvent = globalThis.CloseEvent ?? class extends Event {
	#eventInitDict;
	constructor(type, eventInitDict = {}) {
		super(type, eventInitDict);
		this.#eventInitDict = eventInitDict;
	}
	get wasClean() {
		return this.#eventInitDict.wasClean ?? false;
	}
	get code() {
		return this.#eventInitDict.code ?? 0;
	}
	get reason() {
		return this.#eventInitDict.reason ?? "";
	}
};
/**
* Node.js has no global `ErrorEvent`, unlike `Event`/`MessageEvent`/`CloseEvent`.
* @link https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
*/
const ErrorEvent = globalThis.ErrorEvent ?? class extends Event {
	#eventInitDict;
	constructor(type, eventInitDict = {}) {
		super(type, eventInitDict);
		this.#eventInitDict = eventInitDict;
	}
	get message() {
		return this.#eventInitDict.message ?? "";
	}
	get filename() {
		return this.#eventInitDict.filename ?? "";
	}
	get lineno() {
		return this.#eventInitDict.lineno ?? 0;
	}
	get colno() {
		return this.#eventInitDict.colno ?? 0;
	}
	get error() {
		return this.#eventInitDict.error ?? null;
	}
};
const generateConnectionSymbol = () => Symbol("connection");
const CONNECTION_SYMBOL_KEY = Symbol("CONNECTION_SYMBOL_KEY");
const WAIT_FOR_WEBSOCKET_SYMBOL = Symbol("WAIT_FOR_WEBSOCKET_SYMBOL");
const responseHeadersToSkip = new Set([
	"connection",
	"content-length",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"sec-websocket-accept",
	"sec-websocket-extensions",
	"sec-websocket-protocol"
]);
const appendResponseHeaders = (headers, responseHeaders) => {
	if (!responseHeaders) return;
	responseHeaders.forEach((value, key) => {
		if (responseHeadersToSkip.has(key.toLowerCase())) return;
		headers.push(`${key}: ${value}`);
	});
};
const rejectUpgradeRequest = (socket, status, responseHeaders) => {
	const responseLines = ["Connection: close", "Content-Length: 0"];
	appendResponseHeaders(responseLines, responseHeaders);
	socket.end(`HTTP/1.1 ${status.toString()} ${STATUS_CODES[status] ?? ""}\r\n${responseLines.join("\r\n")}\r\n\r
`);
};
const createUpgradeRequest = (request) => {
	const protocol = request.socket.encrypted ? "https" : "http";
	const url = new URL(request.url ?? "/", `${protocol}://${request.headers.host ?? "localhost"}`);
	const headers = new Headers();
	for (const key in request.headers) {
		const value = request.headers[key];
		if (!value) continue;
		headers.append(key, Array.isArray(value) ? value[0] : value);
	}
	return new Request(url, { headers });
};
const setupWebSocket = (options) => {
	const { server, fetchCallback, wss } = options;
	const waiterMap = /* @__PURE__ */ new Map();
	wss.on("connection", (ws, request) => {
		const waiter = waiterMap.get(request);
		if (waiter) {
			waiter.resolve(ws);
			waiterMap.delete(request);
		}
	});
	const rejectWaiter = (request) => {
		const waiter = waiterMap.get(request);
		if (waiter) {
			waiterMap.delete(request);
			waiter.reject(/* @__PURE__ */ new Error("WebSocket handshake aborted"));
		}
	};
	const waitForWebSocket = (request, connectionSymbol) => {
		return new Promise((resolve, reject) => {
			waiterMap.set(request, {
				resolve,
				reject,
				connectionSymbol
			});
		});
	};
	server.on("upgrade", async (request, socket, head) => {
		if (request.headers.upgrade?.toLowerCase() !== "websocket") return;
		const env = {
			incoming: request,
			outgoing: void 0,
			wss,
			[WAIT_FOR_WEBSOCKET_SYMBOL]: waitForWebSocket
		};
		let status = 400;
		let responseHeaders;
		try {
			const response = await fetchCallback(createUpgradeRequest(request), env);
			if (response instanceof Response) {
				status = response.status;
				responseHeaders = response.headers;
			}
		} catch {
			if (server.listenerCount("upgrade") === 1) rejectUpgradeRequest(socket, 500);
			return;
		}
		const waiter = waiterMap.get(request);
		if (!waiter || waiter.connectionSymbol !== env[CONNECTION_SYMBOL_KEY]) {
			rejectWaiter(request);
			if (server.listenerCount("upgrade") === 1) rejectUpgradeRequest(socket, status, responseHeaders);
			return;
		}
		const addResponseHeaders = (headers) => {
			appendResponseHeaders(headers, responseHeaders);
		};
		const reclaimWaiterOnClose = () => rejectWaiter(request);
		socket.once("close", reclaimWaiterOnClose);
		wss.on("headers", addResponseHeaders);
		try {
			wss.handleUpgrade(request, socket, head, (ws) => {
				socket.off("close", reclaimWaiterOnClose);
				wss.emit("connection", ws, request);
			});
		} finally {
			wss.off("headers", addResponseHeaders);
		}
	});
	server.on("close", () => {
		wss.close();
	});
};
const upgradeWebSocket = defineWebSocketHelper(async (c, events, options) => {
	if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return;
	const env = c.env;
	const waitForWebSocket = env[WAIT_FOR_WEBSOCKET_SYMBOL];
	if (!waitForWebSocket || !env.incoming) return new Response(null, { status: 500 });
	const connectionSymbol = generateConnectionSymbol();
	env[CONNECTION_SYMBOL_KEY] = connectionSymbol;
	(async () => {
		let ws;
		try {
			ws = await waitForWebSocket(env.incoming, connectionSymbol);
		} catch {
			return;
		}
		const messagesReceivedInStarting = [];
		const bufferMessage = (data, isBinary) => {
			messagesReceivedInStarting.push([data, isBinary]);
		};
		ws.on("message", bufferMessage);
		const ctx = {
			binaryType: "arraybuffer",
			close(code, reason) {
				ws.close(code, reason);
			},
			protocol: ws.protocol,
			raw: ws,
			get readyState() {
				return ws.readyState;
			},
			send(source, opts) {
				ws.send(source, { compress: opts?.compress });
			},
			url: new URL(c.req.url)
		};
		try {
			events?.onOpen?.(new Event("open"), ctx);
		} catch (e) {
			(options?.onError ?? console.error)(e);
		}
		const handleMessage = (data, isBinary) => {
			const datas = Array.isArray(data) ? data : [data];
			for (const data of datas) try {
				events?.onMessage?.(new MessageEvent("message", { data: isBinary ? data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : typeof data === "string" ? data : Buffer.from(data).toString("utf-8") }), ctx);
			} catch (e) {
				(options?.onError ?? console.error)(e);
			}
		};
		ws.off("message", bufferMessage);
		for (const message of messagesReceivedInStarting) handleMessage(...message);
		ws.on("message", (data, isBinary) => {
			handleMessage(data, isBinary);
		});
		ws.on("close", (code, reason) => {
			try {
				events?.onClose?.(new CloseEvent("close", {
					code,
					reason: reason.toString()
				}), ctx);
			} catch (e) {
				(options?.onError ?? console.error)(e);
			}
		});
		ws.on("error", (error) => {
			try {
				events?.onError?.(new ErrorEvent("error", { error }), ctx);
			} catch (e) {
				(options?.onError ?? console.error)(e);
			}
		});
	})();
	return new Response();
});

//#endregion
//#region src/server.ts
const createAdaptorServer = (options) => {
	const fetchCallback = options.fetch;
	const requestListener = getRequestListener(fetchCallback, {
		hostname: options.hostname,
		overrideGlobalObjects: options.overrideGlobalObjects,
		autoCleanupIncoming: options.autoCleanupIncoming
	});
	const server = (options.createServer || createServer)(options.serverOptions || {}, requestListener);
	if (options.websocket && options.websocket.server) {
		if (options.websocket.server.options.noServer !== true) throw new Error("WebSocket server must be created with { noServer: true } option");
		setupWebSocket({
			server,
			fetchCallback,
			wss: options.websocket.server
		});
	}
	return server;
};
const serve = (options, listeningListener) => {
	const server = createAdaptorServer(options);
	server.listen(options?.port ?? 3e3, options.hostname, () => {
		const serverInfo = server.address();
		listeningListener && listeningListener(serverInfo);
	});
	return server;
};

//#endregion
export { RequestError, createAdaptorServer, getRequestListener, serve, upgradeWebSocket };