"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makePassthroughRequest = makePassthroughRequest;
const logger_1 = require("../logging/logger");
const join_1 = require("../url/join");
const EndpointSupplier_1 = require("./EndpointSupplier");
const getFetchFn_1 = require("./getFetchFn");
const makeRequest_1 = require("./makeRequest");
const requestWithRetries_1 = require("./requestWithRetries");
const Supplier_1 = require("./Supplier");
/**
 * Makes a passthrough HTTP request using the SDK's configuration (auth, retry, logging, etc.)
 * while mimicking the standard `fetch` API.
 *
 * @param input - The URL, path, or Request object. If a relative path, it will be resolved against the configured base URL.
 * @param init - Standard RequestInit options (method, headers, body, signal, etc.)
 * @param clientOptions - SDK client options (auth, default headers, logging, etc.)
 * @param requestOptions - Per-request overrides (timeout, retries, extra headers, abort signal).
 * @returns A standard Response object.
 */
function makePassthroughRequest(input, init, clientOptions, requestOptions) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const logger = (0, logger_1.createLogger)(clientOptions.logging);
        // Extract URL and default init properties from Request object if provided
        let url;
        let effectiveInit = init;
        if (input instanceof Request) {
            url = input.url;
            // If no explicit init provided, extract properties from the Request object
            if (init == null) {
                effectiveInit = {
                    method: input.method,
                    headers: Object.fromEntries(input.headers.entries()),
                    body: input.body,
                    signal: input.signal,
                    credentials: input.credentials,
                    cache: input.cache,
                    redirect: input.redirect,
                    referrer: input.referrer,
                    integrity: input.integrity,
                    mode: input.mode,
                };
            }
        }
        else {
            url = input instanceof URL ? input.toString() : input;
        }
        // Resolve the base URL
        const baseUrl = (_a = (clientOptions.baseUrl != null ? yield Supplier_1.Supplier.get(clientOptions.baseUrl) : undefined)) !== null && _a !== void 0 ? _a : (clientOptions.environment != null ? yield Supplier_1.Supplier.get(clientOptions.environment) : undefined);
        // Determine the full URL
        let fullUrl;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            fullUrl = url;
        }
        else if (baseUrl != null) {
            fullUrl = (0, join_1.join)(baseUrl, url);
        }
        else {
            fullUrl = url;
        }
        // Merge headers: SDK default headers -> auth headers -> user-provided headers
        const mergedHeaders = {};
        // Apply SDK default headers (resolve suppliers)
        if (clientOptions.headers != null) {
            for (const [key, value] of Object.entries(clientOptions.headers)) {
                const resolved = yield EndpointSupplier_1.EndpointSupplier.get(value, { endpointMetadata: {} });
                if (resolved != null) {
                    mergedHeaders[key.toLowerCase()] = `${resolved}`;
                }
            }
        }
        // Apply auth headers
        if (clientOptions.getAuthHeaders != null) {
            const authHeaders = yield clientOptions.getAuthHeaders();
            for (const [key, value] of Object.entries(authHeaders)) {
                mergedHeaders[key.toLowerCase()] = value;
            }
        }
        // Apply user-provided headers from init
        if ((effectiveInit === null || effectiveInit === void 0 ? void 0 : effectiveInit.headers) != null) {
            const initHeaders = effectiveInit.headers instanceof Headers
                ? Object.fromEntries(effectiveInit.headers.entries())
                : Array.isArray(effectiveInit.headers)
                    ? Object.fromEntries(effectiveInit.headers)
                    : effectiveInit.headers;
            for (const [key, value] of Object.entries(initHeaders)) {
                if (value != null) {
                    mergedHeaders[key.toLowerCase()] = value;
                }
            }
        }
        // Apply per-request option headers (highest priority)
        if ((requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.headers) != null) {
            for (const [key, value] of Object.entries(requestOptions.headers)) {
                mergedHeaders[key.toLowerCase()] = value;
            }
        }
        const method = (_b = effectiveInit === null || effectiveInit === void 0 ? void 0 : effectiveInit.method) !== null && _b !== void 0 ? _b : "GET";
        const body = effectiveInit === null || effectiveInit === void 0 ? void 0 : effectiveInit.body;
        const timeoutInSeconds = (_c = requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.timeoutInSeconds) !== null && _c !== void 0 ? _c : clientOptions.timeoutInSeconds;
        const timeoutMs = timeoutInSeconds != null ? timeoutInSeconds * 1000 : undefined;
        const maxRetries = (_d = requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.maxRetries) !== null && _d !== void 0 ? _d : clientOptions.maxRetries;
        const abortSignal = (_f = (_e = requestOptions === null || requestOptions === void 0 ? void 0 : requestOptions.abortSignal) !== null && _e !== void 0 ? _e : effectiveInit === null || effectiveInit === void 0 ? void 0 : effectiveInit.signal) !== null && _f !== void 0 ? _f : undefined;
        const fetchFn = (_g = clientOptions.fetch) !== null && _g !== void 0 ? _g : (yield (0, getFetchFn_1.getFetchFn)());
        if (logger.isDebug()) {
            logger.debug("Making passthrough HTTP request", {
                method,
                url: fullUrl,
                hasBody: body != null,
            });
        }
        const response = yield (0, requestWithRetries_1.requestWithRetries)(() => __awaiter(this, void 0, void 0, function* () {
            return (0, makeRequest_1.makeRequest)(fetchFn, fullUrl, method, mergedHeaders, body !== null && body !== void 0 ? body : undefined, timeoutMs, abortSignal, (effectiveInit === null || effectiveInit === void 0 ? void 0 : effectiveInit.credentials) === "include", undefined, // duplex
            false);
        }), maxRetries);
        if (logger.isDebug()) {
            logger.debug("Passthrough HTTP request completed", {
                method,
                url: fullUrl,
                statusCode: response.status,
            });
        }
        return response;
    });
}
