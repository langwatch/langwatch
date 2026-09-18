"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechEngineResource = void 0;
exports.verifySpeechEngineJwt = verifySpeechEngineJwt;
const node_crypto_1 = require("node:crypto");
const ws_1 = __importDefault(require("ws"));
const core = __importStar(require("../../core"));
const types_1 = require("./types");
const SpeechEngineSession_1 = require("./SpeechEngineSession");
const SpeechEngineAttachment_1 = require("./SpeechEngineAttachment");
/**
 * Represents a speech engine instance. Returned by `elevenlabs.speechEngine.get()`.
 *
 * Use `engine.attach(httpServer, path, callbacks)` to integrate with an existing
 * HTTP server, or drop down to `engine.verifyRequest()` and `engine.createSession()`
 * for full control.
 *
 * @example
 * ```typescript
 * const engine = await elevenlabs.speechEngine.get("seng_123");
 *
 * engine.attach(httpServer, "/api/speech-engine/ws", {
 *     async onTranscript(transcript, signal, session) {
 *         session.sendResponse(await llm.generate(transcript, { signal }));
 *     },
 * });
 * ```
 */
class SpeechEngineResource {
    /** @internal */
    constructor(engineId, options, response) {
        this.engineId = engineId;
        this._options = options;
        if (response) {
            const { speechEngineId: _id } = response, config = __rest(response, ["speechEngineId"]);
            this.config = config;
        }
    }
    /**
     * Attach to an existing HTTP server and begin accepting Speech Engine
     * connections at the given path.
     *
     * Handles WebSocket upgrades, path routing, and request verification
     * automatically. Returns a `SpeechEngineAttachment` whose `.close()` stops
     * accepting connections without affecting the HTTP server.
     *
     * @example
     * ```typescript
     * engine.attach(httpServer, "/api/speech-engine/ws", {
     *     async onTranscript(transcript, signal, session) {
     *         const stream = await openai.responses.create({ model: "gpt-4o", input: transcript, stream: true }, { signal });
     *         session.sendResponse(stream);
     *     },
     * });
     * ```
     */
    attach(httpServer, path, handler) {
        var _a, _b;
        const debug = (_a = handler.debug) !== null && _a !== void 0 ? _a : false;
        const disableAuth = (_b = handler.disableAuth) !== null && _b !== void 0 ? _b : false;
        const log = debug ? (...args) => console.log("[SpeechEngine]", ...args) : () => { };
        if (disableAuth) {
            console.warn("[SpeechEngine] authentication is disabled on attach() — incoming connections will NOT be verified. " +
                "Make sure the server is protected by either IP allowlist restricting traffic to ElevenLabs or using custom header values.");
        }
        const wss = new ws_1.default.Server({ noServer: true });
        const upgradeListener = (req, socket, head) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            const url = new URL((_a = req.url) !== null && _a !== void 0 ? _a : "/", `http://${req.headers.host}`);
            log(`upgrade request: ${req.method} ${url.pathname}`);
            if (url.pathname !== path) {
                log(`path mismatch: expected ${path}, got ${url.pathname} — skipping`);
                return;
            }
            if (disableAuth) {
                log("auth disabled, upgrading connection without verification");
            }
            else if (!(yield this.verifyRequest(req))) {
                // verifyRequest returned false — get the detailed reason for debug logging
                const reason = yield this.getVerificationFailure(req);
                log(`rejected connection — ${reason}`);
                socket.destroy();
                return;
            }
            else {
                log("upgrading connection to WebSocket");
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                log("WebSocket connection established");
                wss.emit("connection", ws);
            });
        });
        httpServer.on("upgrade", upgradeListener);
        wss.on("connection", (ws) => {
            log("creating new session");
            const session = this.createSession(ws, { debug });
            this.wireHandler(session, handler);
        });
        log(`listening for WebSocket upgrades on ${path}`);
        return new SpeechEngineAttachment_1.SpeechEngineAttachment(wss, httpServer, upgradeListener);
    }
    /**
     * Verify that an incoming HTTP upgrade request is a legitimate connection
     * from the ElevenLabs Speech Engine API.
     *
     * Checks the `X-Elevenlabs-Speech-Engine-Authorization` header for a valid
     * JWT signed with the SHA-256 hash of the API key.
     *
     * Only needed when managing the WebSocket upgrade yourself. When using
     * `engine.attach()`, verification is handled automatically.
     */
    verifyRequest(req) {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield this.getVerificationFailure(req)) === null;
        });
    }
    /** @internal Returns `null` when the request is valid, or a human-readable reason when rejected. */
    getVerificationFailure(req) {
        return __awaiter(this, void 0, void 0, function* () {
            const apiKey = yield core.Supplier.get(this._options.apiKey);
            if (!apiKey) {
                return "no API key configured on the client";
            }
            const raw = req.headers["x-elevenlabs-speech-engine-authorization"];
            const headerValue = Array.isArray(raw) ? raw[0] : raw;
            if (!headerValue) {
                return "missing X-Elevenlabs-Speech-Engine-Authorization header";
            }
            try {
                verifySpeechEngineJwt(headerValue, apiKey);
                return null;
            }
            catch (err) {
                return err instanceof Error ? err.message : String(err);
            }
        });
    }
    /**
     * Wrap an accepted WebSocket in a `SpeechEngineSession`.
     *
     * Only needed when managing the WebSocket upgrade yourself. When using
     * `engine.attach()`, sessions are created automatically.
     */
    createSession(ws, options) {
        return new SpeechEngineSession_1.SpeechEngineSession(ws, options);
    }
    /** @internal */
    wireHandler(session, handler) {
        const { onInit, onTranscript, onClose, onDisconnect, onError } = handler;
        if (onInit)
            session.on("init", (id) => onInit.call(session, id, session));
        if (onTranscript) {
            session.on("user_transcript", (t, s) => {
                Promise.resolve(onTranscript.call(session, t, s, session)).catch((err) => {
                    if ((0, types_1.isAbortError)(err))
                        return;
                    const error = err instanceof Error ? err : new Error(String(err));
                    if (onError)
                        onError.call(session, error, session);
                });
            });
        }
        if (onClose)
            session.on("close", () => onClose.call(session, session));
        if (onDisconnect)
            session.on("disconnected", () => onDisconnect.call(session, session));
        if (onError)
            session.on("error", (err) => onError.call(session, err, session));
    }
}
exports.SpeechEngineResource = SpeechEngineResource;
// ---------------------------------------------------------------------------
// JWT verification (HS256, no external dependency)
// ---------------------------------------------------------------------------
const ISSUER = "https://api.elevenlabs.io/convai/speech-engine";
const SUBJECT = "convai_speech_engine_upstream";
const LEEWAY_SECONDS = 60;
function base64UrlDecode(input) {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(padded, "base64");
}
/** @internal — exported for testing only */
function verifySpeechEngineJwt(value, apiKey) {
    let token = value.trim();
    if (token.toLowerCase().startsWith("bearer ")) {
        token = token.slice(7).trim();
    }
    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT: expected 3 parts");
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf-8"));
    }
    catch (_a) {
        throw new Error("Invalid JWT: failed to decode payload");
    }
    // SHA-256 hash of the API key, used as the HMAC secret
    const trimmedKey = apiKey.trim();
    const secret = (0, node_crypto_1.createHash)("sha256").update(trimmedKey, "utf-8").digest();
    const expectedSignature = (0, node_crypto_1.createHmac)("sha256", secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest();
    const actualSignature = base64UrlDecode(signatureB64);
    if (!expectedSignature.equals(actualSignature)) {
        throw new Error("Invalid JWT: signature mismatch — make sure the API key used by your Speech Engine server matches the one used to create the engine.");
    }
    if (payload.iss !== ISSUER) {
        throw new Error(`Invalid JWT: expected issuer "${ISSUER}", got "${payload.iss}"`);
    }
    if (payload.sub !== SUBJECT) {
        throw new Error(`Invalid JWT: expected subject "${SUBJECT}", got "${payload.sub}"`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number") {
        throw new Error("Invalid JWT: missing exp claim");
    }
    if (typeof payload.iat !== "number") {
        throw new Error("Invalid JWT: missing iat claim");
    }
    if (payload.exp + LEEWAY_SECONDS < now) {
        throw new Error("Invalid JWT: token has expired");
    }
    if (payload.iat - LEEWAY_SECONDS > now) {
        throw new Error("Invalid JWT: iat is in the future");
    }
    return payload;
}
