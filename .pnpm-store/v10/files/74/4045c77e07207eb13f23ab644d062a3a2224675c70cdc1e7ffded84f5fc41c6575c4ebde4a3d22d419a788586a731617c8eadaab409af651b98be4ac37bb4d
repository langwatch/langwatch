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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeechEngineSession = void 0;
const node_events_1 = require("node:events");
const ws_1 = __importDefault(require("ws"));
const types_1 = require("./types");
/**
 * Wraps a WebSocket connection from the ElevenLabs Speech Engine API into a
 * typed, event-driven session.
 *
 * The ElevenLabs API connects to the developer's server via WebSocket. Each
 * connection represents one conversation. The session emits events for
 * transcripts and lifecycle changes, and provides methods to send LLM
 * responses back. When a new transcript arrives, the previous transcript's
 * abort signal is fired automatically, cancelling any in-flight LLM call.
 *
 * @example
 * ```typescript
 * import { SpeechEngine } from "@elevenlabs/elevenlabs-js";
 *
 * wss.on("connection", (ws) => {
 *     const session = new SpeechEngine.Session(ws);
 *
 *     session.on(SpeechEngine.USER_TRANSCRIPT, async (transcript, { signal }) => {
 *         const response = await llm.generate(transcript, { signal });
 *         session.sendResponse(response);
 *     });
 * });
 * ```
 */
class SpeechEngineSession {
    constructor(ws, options) {
        this.emitter = new node_events_1.EventEmitter();
        this.currentAbortController = null;
        this.inTranscriptHandler = false;
        this.closed = false;
        this.ws = ws;
        this.log = (options === null || options === void 0 ? void 0 : options.debug) ? (...args) => console.log("[SpeechEngine]", ...args) : () => { };
        this.setupWebSocket();
    }
    // -----------------------------------------------------------------------
    // Event emitter interface
    // -----------------------------------------------------------------------
    on(event, listener) {
        this.emitter.on(event, listener);
        return this;
    }
    off(event, listener) {
        this.emitter.off(event, listener);
        return this;
    }
    once(event, listener) {
        this.emitter.once(event, listener);
        return this;
    }
    // -----------------------------------------------------------------------
    // Sending responses
    // -----------------------------------------------------------------------
    /**
     * Send an LLM response back to the Speech Engine API for TTS synthesis.
     *
     * Accepts a complete string, an `AsyncIterable<string>` for streaming
     * token-by-token responses, or an LLM stream that yields event objects
     * (e.g. an OpenAI Responses API stream). Event objects are automatically
     * parsed to extract text deltas.
     */
    sendResponse(response) {
        if (this.closed) {
            throw new Error("Cannot send response: session is closed");
        }
        if (!this.inTranscriptHandler) {
            console.warn("[SpeechEngine] sendResponse() called outside of an onTranscript handler. " +
                "Responses can only be sent in reply to a user transcript. " +
                "To have the agent speak first, set a first message in your Speech Engine conversation config on the client.");
            return Promise.resolve();
        }
        if (typeof response === "string") {
            this.log(`sending string response: "${response}", event_id=${this.currentEventId}`);
            this.sendAgentResponse(response, false);
            this.sendAgentResponse("", true);
            return Promise.resolve();
        }
        else {
            this.log(`starting streamed response, event_id=${this.currentEventId}`);
            return this.streamResponse(response).catch((err) => {
                if ((0, types_1.isAbortError)(err))
                    return;
                this.emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
            });
        }
    }
    /**
     * Close the session and the underlying WebSocket connection.
     */
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.inTranscriptHandler = false;
        this.abortCurrent();
        this.ws.close();
    }
    /**
     * The conversation ID assigned by the Speech Engine API, available after
     * the `init` event.
     */
    get conversationId() {
        return this._conversationId;
    }
    /**
     * Whether the session is still open.
     */
    get isOpen() {
        return !this.closed && this.ws.readyState === ws_1.default.OPEN;
    }
    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------
    setupWebSocket() {
        this.ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleMessage(msg);
            }
            catch (err) {
                this.emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
            }
        });
        this.ws.on("close", () => {
            this.closed = true;
            this.inTranscriptHandler = false;
            this.abortCurrent();
            this.emitter.emit("disconnected");
        });
        this.ws.on("error", (err) => {
            this.emitter.emit("error", err);
        });
    }
    handleMessage(msg) {
        switch (msg.type) {
            case "init": {
                this._conversationId = msg.conversation_id;
                this.log(`session initialized, conversation_id=${msg.conversation_id}`);
                this.emitter.emit("init", msg.conversation_id);
                break;
            }
            case "user_transcript": {
                if (msg.event_id !== undefined && msg.event_id === this.currentEventId && this.currentAbortController !== null) {
                    this.log(`skipping duplicate transcript, event_id=${msg.event_id}`);
                    break;
                }
                const wasActive = this.currentAbortController !== null;
                this.abortCurrent();
                if (wasActive) {
                    this.log(`interrupted: aborting previous response (event_id=${this.currentEventId}) for new transcript (event_id=${msg.event_id})`);
                }
                this.currentAbortController = new AbortController();
                this.currentEventId = msg.event_id;
                this.log(`received transcript, event_id=${msg.event_id}, messages=${msg.user_transcript.length}`);
                this.inTranscriptHandler = true;
                this.emitter.emit("user_transcript", msg.user_transcript, this.currentAbortController.signal);
                break;
            }
            case "ping": {
                this.send({ type: "pong" });
                break;
            }
            case "close": {
                this.inTranscriptHandler = false;
                this.abortCurrent();
                this.emitter.emit("close");
                break;
            }
            case "error": {
                this.emitter.emit("error", new Error(msg.message));
                break;
            }
            default: {
                // Unknown message types are silently ignored so the SDK
                // stays forward-compatible as the protocol evolves.
                break;
            }
        }
    }
    streamResponse(stream) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, stream_1, stream_1_1;
            var _b, e_1, _c, _d;
            const eventId = this.currentEventId;
            let chunks = 0;
            try {
                for (_a = true, stream_1 = __asyncValues(stream); stream_1_1 = yield stream_1.next(), _b = stream_1_1.done, !_b; _a = true) {
                    _d = stream_1_1.value;
                    _a = false;
                    const chunk = _d;
                    if (this.closed) {
                        this.log(`stream stopped: session closed after ${chunks} chunks, event_id=${eventId}`);
                        return;
                    }
                    const text = this.extractText(chunk);
                    if (text) {
                        chunks++;
                        this.sendAgentResponse(text, false, eventId);
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_a && !_b && (_c = stream_1.return)) yield _c.call(stream_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            if (!this.closed) {
                this.log(`stream complete: ${chunks} chunks sent, event_id=${eventId}`);
                this.sendAgentResponse("", true, eventId);
            }
        });
    }
    /**
     * Extract text content from a stream chunk. Handles plain strings and
     * common LLM stream event formats:
     *
     * - OpenAI Responses API (`response.output_text.delta`)
     * - OpenAI Chat Completions API (`choices[0].delta.content`)
     * - Anthropic Messages API (`content_block_delta` with `text_delta`)
     * - Google Gemini API (`candidates[0].content.parts[0].text`)
     */
    extractText(chunk) {
        var _a, _b, _c;
        if (typeof chunk === "string")
            return chunk;
        if (typeof chunk !== "object" || chunk === null)
            return null;
        const event = chunk;
        // OpenAI Responses API: { type: "response.output_text.delta", delta: "text" }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            return event.delta;
        }
        // OpenAI Chat Completions API: { choices: [{ delta: { content: "text" } }] }
        if (Array.isArray(event.choices)) {
            const content = (_a = event.choices[0]) === null || _a === void 0 ? void 0 : _a.delta;
            if (typeof content === "object" && content !== null && typeof content.content === "string") {
                return content.content;
            }
        }
        // Anthropic Messages API: { type: "content_block_delta", delta: { type: "text_delta", text: "text" } }
        if (event.type === "content_block_delta" && typeof event.delta === "object" && event.delta !== null) {
            const delta = event.delta;
            if (delta.type === "text_delta" && typeof delta.text === "string") {
                return delta.text;
            }
        }
        // Google Gemini API: { candidates: [{ content: { parts: [{ text: "text" }] } }] }
        if (Array.isArray(event.candidates)) {
            const content = (_b = event.candidates[0]) === null || _b === void 0 ? void 0 : _b.content;
            if (typeof content === "object" && content !== null) {
                const parts = content.parts;
                if (Array.isArray(parts) && typeof ((_c = parts[0]) === null || _c === void 0 ? void 0 : _c.text) === "string") {
                    return parts[0].text;
                }
            }
        }
        return null;
    }
    sendAgentResponse(content, isFinal, eventId) {
        this.send({ type: "agent_response", content, event_id: eventId !== null && eventId !== void 0 ? eventId : this.currentEventId, is_final: isFinal });
    }
    send(msg) {
        if (this.closed)
            return;
        this.ws.send(JSON.stringify(msg));
    }
    abortCurrent() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }
    }
}
exports.SpeechEngineSession = SpeechEngineSession;
