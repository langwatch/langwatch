"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechEngineServer = void 0;
const node_http_1 = require("node:http");
const ws_1 = __importDefault(require("ws"));
const types_1 = require("./types");
const SpeechEngineSession_1 = require("./SpeechEngineSession");
const SpeechEngineResource_1 = require("./SpeechEngineResource");
/**
 * Standalone WebSocket server that produces `SpeechEngineSession` instances for
 * each incoming connection from the ElevenLabs Speech Engine API.
 *
 * Every incoming connection is verified against the ElevenLabs API using the
 * configured API key before being accepted.
 *
 * For integration with an existing HTTP server (e.g. Express, Next.js), use
 * `engine.attach()` instead.
 */
class SpeechEngineServer {
    constructor(options) {
        this.wss = null;
        this.httpServer = null;
        this.options = options;
    }
    /**
     * Create a `SpeechEngineSession` from an existing WebSocket. Use this
     * when you manage your own WebSocket server and want to wrap individual
     * connections.
     */
    handleConnection(ws) {
        const session = new SpeechEngineSession_1.SpeechEngineSession(ws, { debug: this.options.debug });
        this.wireHandler(session);
        return session;
    }
    /**
     * Start the standalone WebSocket server on the configured port.
     */
    start() {
        var _a, _b, _c, _d;
        if (this.wss) {
            throw new Error("Server is already started");
        }
        const disableAuth = (_a = this.options.disableAuth) !== null && _a !== void 0 ? _a : false;
        const apiKey = (_b = this.options.apiKey) !== null && _b !== void 0 ? _b : process.env.ELEVENLABS_API_KEY;
        if (!apiKey && !disableAuth) {
            throw new Error("SpeechEngine.Server requires an API key to verify incoming connections. " +
                "Pass { apiKey: \"...\" } or set the ELEVENLABS_API_KEY environment variable. " +
                "To run without authentication, pass { disableAuth: true } — but only behind an IP allowlist.");
        }
        const debug = (_c = this.options.debug) !== null && _c !== void 0 ? _c : false;
        const log = debug ? (...args) => console.log("[SpeechEngine]", ...args) : () => { };
        if (disableAuth) {
            console.warn("[SpeechEngine] authentication is disabled — incoming connections will NOT be verified. " +
                "Make sure the server is protected by an IP allowlist restricting traffic to ElevenLabs.");
        }
        const httpServer = (0, node_http_1.createServer)();
        const wss = new ws_1.default.Server({ noServer: true });
        const verifyToken = disableAuth
            ? null
            : (token) => (0, SpeechEngineResource_1.verifySpeechEngineJwt)(token, apiKey);
        httpServer.on("upgrade", (req, socket, head) => {
            if (verifyToken) {
                const headerValue = req.headers["x-elevenlabs-speech-engine-authorization"];
                const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
                if (!token) {
                    log("rejected connection — missing X-Elevenlabs-Speech-Engine-Authorization header");
                    socket.destroy();
                    return;
                }
                try {
                    verifyToken(token);
                }
                catch (err) {
                    log(`rejected connection — ${err instanceof Error ? err.message : String(err)}`);
                    socket.destroy();
                    return;
                }
                log("verified connection, upgrading to WebSocket");
            }
            else {
                log("auth disabled, upgrading connection without verification");
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit("connection", ws);
            });
        });
        wss.on("connection", (ws) => {
            this.handleConnection(ws);
        });
        httpServer.listen((_d = this.options.port) !== null && _d !== void 0 ? _d : 3001);
        this.wss = wss;
        this.httpServer = httpServer;
    }
    wireHandler(session) {
        const { onInit, onTranscript, onClose, onDisconnect, onError } = this.options;
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
    /**
     * Stop the WebSocket server and close all active connections.
     */
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.wss) {
                resolve();
                return;
            }
            this.wss.close((wssErr) => {
                this.wss = null;
                if (this.httpServer) {
                    this.httpServer.close((httpErr) => {
                        this.httpServer = null;
                        if (wssErr || httpErr)
                            reject(wssErr || httpErr);
                        else
                            resolve();
                    });
                }
                else {
                    if (wssErr)
                        reject(wssErr);
                    else
                        resolve();
                }
            });
        });
    }
}
exports.SpeechEngineServer = SpeechEngineServer;
