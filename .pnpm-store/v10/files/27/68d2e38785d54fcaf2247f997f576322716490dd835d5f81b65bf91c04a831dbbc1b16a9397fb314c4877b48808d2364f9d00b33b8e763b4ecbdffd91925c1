"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeConnection = exports.RealtimeEvents = void 0;
const ws_1 = __importDefault(require("ws"));
const node_events_1 = require("node:events");
/**
 * Events emitted by the RealtimeConnection.
 */
var RealtimeEvents;
(function (RealtimeEvents) {
    /** Emitted when the session is successfully started */
    RealtimeEvents["SESSION_STARTED"] = "session_started";
    /** Emitted when a partial (interim) transcript is available */
    RealtimeEvents["PARTIAL_TRANSCRIPT"] = "partial_transcript";
    /** Emitted when a committed transcript is available */
    RealtimeEvents["COMMITTED_TRANSCRIPT"] = "committed_transcript";
    /** Emitted when a committed transcript with timestamps is available */
    RealtimeEvents["COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS"] = "committed_transcript_with_timestamps";
    /** Emitted when an error occurs - can be any error message from the server or a native WebSocket error */
    RealtimeEvents["ERROR"] = "error";
    /** Emitted when an auth error occurs */
    RealtimeEvents["AUTH_ERROR"] = "auth_error";
    /** Emitted when a quota exceeded error occurs */
    RealtimeEvents["QUOTA_EXCEEDED"] = "quota_exceeded";
    /** Emitted when the WebSocket connection is opened */
    RealtimeEvents["OPEN"] = "open";
    /** Emitted when the WebSocket connection is closed */
    RealtimeEvents["CLOSE"] = "close";
    /** Emitted when a commit throttled error occurs */
    RealtimeEvents["COMMIT_THROTTLED"] = "commit_throttled";
    /** Emitted when a transcriber error occurs */
    RealtimeEvents["TRANSCRIBER_ERROR"] = "transcriber_error";
    /** Emitted when a unaccepted terms error occurs */
    RealtimeEvents["UNACCEPTED_TERMS_ERROR"] = "unaccepted_terms_error";
    /** Emitted when a rate limited error occurs */
    RealtimeEvents["RATE_LIMITED"] = "rate_limited";
    /** Emitted when a input error occurs */
    RealtimeEvents["INPUT_ERROR"] = "input_error";
    /** Emitted when a queue overflow error occurs */
    RealtimeEvents["QUEUE_OVERFLOW"] = "queue_overflow";
    /** Emitted when a resource exhausted error occurs */
    RealtimeEvents["RESOURCE_EXHAUSTED"] = "resource_exhausted";
    /** Emitted when a session time limit exceeded error occurs */
    RealtimeEvents["SESSION_TIME_LIMIT_EXCEEDED"] = "session_time_limit_exceeded";
    /** Emitted when a chunk size exceeded error occurs */
    RealtimeEvents["CHUNK_SIZE_EXCEEDED"] = "chunk_size_exceeded";
    /** Emitted when a insufficient audio activity error occurs */
    RealtimeEvents["INSUFFICIENT_AUDIO_ACTIVITY"] = "insufficient_audio_activity";
})(RealtimeEvents || (exports.RealtimeEvents = RealtimeEvents = {}));
/**
 * Manages a real-time transcription WebSocket connection.
 *
 * @remarks
 * **Node.js only**: This class uses Node.js-specific WebSocket implementation.
 *
 * @example
 * ```typescript
 * const connection = await client.speechToText.realtime.connect({
 *     modelId: "scribe_v2_realtime",
 *     audioFormat: AudioFormat.PCM_16000,
 *     sampleRate: 16000,
 * });
 *
 * connection.on(RealtimeEvents.SESSION_STARTED, (data) => {
 *     console.log("Session started");
 * });
 *
 * connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
 *     console.log("Partial:", data.transcript);
 * });
 *
 * connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
 *     console.log("Final:", data.transcript);
 *     connection.close();
 * });
 *
 * // Send audio data
 * connection.send({ audioBase64: base64String });
 *
 * // Commit and close
 * connection.commit();
  * ```
 */
class RealtimeConnection {
    constructor(sampleRate) {
        this.websocket = null;
        this.eventEmitter = new node_events_1.EventEmitter();
        this.ffmpegProcess = null;
        this.currentSampleRate = 16000;
        this.currentSampleRate = sampleRate;
    }
    /**
     * @internal
     * Used internally by ScribeRealtime to attach the WebSocket after connection is created.
     */
    setWebSocket(websocket) {
        this.websocket = websocket;
        // If WebSocket is already open, emit OPEN event immediately
        if (this.websocket.readyState === ws_1.default.OPEN) {
            this.eventEmitter.emit(RealtimeEvents.OPEN);
        }
        else {
            // Otherwise, wait for the open event
            this.websocket.on("open", () => {
                this.eventEmitter.emit(RealtimeEvents.OPEN);
            });
        }
        this.websocket.on("message", (event) => {
            const data = JSON.parse(event.toString());
            switch (data.message_type) {
                case "session_started":
                    this.eventEmitter.emit(RealtimeEvents.SESSION_STARTED, data);
                    break;
                case "partial_transcript":
                    this.eventEmitter.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, data);
                    break;
                case "committed_transcript":
                    this.eventEmitter.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, data);
                    break;
                case "committed_transcript_with_timestamps":
                    this.eventEmitter.emit(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, data);
                    break;
                case "error":
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "auth_error":
                    this.eventEmitter.emit(RealtimeEvents.AUTH_ERROR, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "quota_exceeded":
                    this.eventEmitter.emit(RealtimeEvents.QUOTA_EXCEEDED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "commit_throttled":
                    this.eventEmitter.emit(RealtimeEvents.COMMIT_THROTTLED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "transcriber_error":
                    this.eventEmitter.emit(RealtimeEvents.TRANSCRIBER_ERROR, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "unaccepted_terms_error":
                    this.eventEmitter.emit(RealtimeEvents.UNACCEPTED_TERMS_ERROR, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "rate_limited":
                    this.eventEmitter.emit(RealtimeEvents.RATE_LIMITED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "input_error":
                    this.eventEmitter.emit(RealtimeEvents.INPUT_ERROR, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "queue_overflow":
                    this.eventEmitter.emit(RealtimeEvents.QUEUE_OVERFLOW, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "resource_exhausted":
                    this.eventEmitter.emit(RealtimeEvents.RESOURCE_EXHAUSTED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "session_time_limit_exceeded":
                    this.eventEmitter.emit(RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "chunk_size_exceeded":
                    this.eventEmitter.emit(RealtimeEvents.CHUNK_SIZE_EXCEEDED, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
                case "insufficient_audio_activity":
                    this.eventEmitter.emit(RealtimeEvents.INSUFFICIENT_AUDIO_ACTIVITY, data);
                    this.eventEmitter.emit(RealtimeEvents.ERROR, data);
                    break;
            }
        });
        this.websocket.on("error", (error) => {
            this.eventEmitter.emit(RealtimeEvents.ERROR, error);
        });
        this.websocket.on("close", () => {
            this.eventEmitter.emit(RealtimeEvents.CLOSE);
            this.cleanup();
        });
    }
    /**
     * @internal
     * Used internally by ScribeRealtime to attach ffmpeg process for cleanup.
     */
    setFfmpegProcess(ffmpegProcess) {
        this.ffmpegProcess = ffmpegProcess;
    }
    /**
     * Attaches an event listener for the specified event.
     *
     * @param event - The event to listen for (use RealtimeEvents enum)
     * @param listener - The callback function to execute when the event fires
     *
     * @example
     * ```typescript
     * connection.on(RealtimeEvents.SESSION_STARTED, (data) => {
     *     console.log("Session started", data);
     * });
     *
     * connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
     *     console.log("Partial:", data.transcript);
     * });
     *
     * connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
     *     console.log("Final:", data.transcript);
     * });
     *
     * connection.on(RealtimeEvents.ERROR, (error) => {
     *     // error can be any error message type or native Error
     *     if ('message_type' in error) {
     *         console.error("Server error:", error.message_type, error.error);
     *     } else {
     *         console.error("WebSocket error:", error.message);
     *     }
     * });
     * ```
     */
    on(event, listener) {
        this.eventEmitter.on(event, listener);
    }
    /**
     * Removes an event listener for the specified event.
     *
     * @param event - The event to stop listening for
     * @param listener - The callback function to remove
     *
     * @example
     * ```typescript
     * const handler = (data) => console.log(data);
     * connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, handler);
     *
     * // Later, remove the listener
     * connection.off(RealtimeEvents.PARTIAL_TRANSCRIPT, handler);
     * ```
     */
    off(event, listener) {
        this.eventEmitter.off(event, listener);
    }
    /**
     * Sends audio data to the transcription service.
     *
     * @param data - Audio data configuration
     * @param data.audioBase64 - Base64-encoded audio data
     * @param data.commit - Whether to commit the transcription after this chunk. You likely want to use connection.commit() instead (default: false)
     * @param data.sampleRate - Sample rate of the audio (default: configured sample rate)
     * @param data.previousText - Send text context to the model. Can only be sent alongside the first audio chunk. If sent in a subsequent chunk, an error will be returned.
     * @throws {Error} If the WebSocket connection is not open
     *
     * @example
     * ```typescript
     * // Send audio chunk without committing
     * connection.send({
     *     audioBase64: base64EncodedAudio,
     * });
     *
     * // Send audio chunk with custom sample rate
     * connection.send({
     *     audioBase64: base64EncodedAudio,
     *     sampleRate: 16000,
     * });
     * ```
     */
    send(data) {
        var _a, _b;
        if (!this.websocket || this.websocket.readyState !== ws_1.default.OPEN) {
            throw new Error("WebSocket is not connected");
        }
        const message = {
            message_type: "input_audio_chunk",
            audio_base_64: data.audioBase64,
            commit: (_a = data.commit) !== null && _a !== void 0 ? _a : false,
            sample_rate: (_b = data.sampleRate) !== null && _b !== void 0 ? _b : this.currentSampleRate,
            previous_text: data.previousText,
        };
        this.websocket.send(JSON.stringify(message));
    }
    /**
     * Commits the segment, triggering a COMMITTED_TRANSCRIPT event and clearing the buffer.
     * It's recommend to commit often when using CommitStrategy.MANUAL to keep latency low.
     *
     * @throws {Error} If the WebSocket connection is not open
     *
     * @remarks
     * Only needed when using CommitStrategy.MANUAL.
     * When using CommitStrategy.VAD, commits are handled automatically by the server.
     *
     * @example
     * ```typescript
     * // Send all audio chunks
     * for (const chunk of audioChunks) {
     *     connection.send({ audioBase64: chunk });
     * }
     *
     * // Finalize the transcription
     * connection.commit();
     * ```
     */
    commit() {
        if (!this.websocket || this.websocket.readyState !== ws_1.default.OPEN) {
            throw new Error("WebSocket is not connected");
        }
        const message = {
            message_type: "input_audio_chunk",
            audio_base_64: "",
            commit: true,
            sample_rate: this.currentSampleRate,
        };
        this.websocket.send(JSON.stringify(message));
    }
    /**
     * Closes the WebSocket connection and cleans up resources.
     * This will terminate any ongoing transcription and stop ffmpeg processes if running.
     *
     * @remarks
     * After calling close(), this connection cannot be reused.
     * Create a new connection if you need to start transcribing again.
     *
     * @example
     * ```typescript
     * connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
     *     console.log("Final:", data.transcript);
     *     connection.close();
     * });
     * ```
     */
    close() {
        this.cleanup();
        if (this.websocket) {
            this.websocket.close();
        }
    }
    cleanup() {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill();
            this.ffmpegProcess = null;
        }
    }
}
exports.RealtimeConnection = RealtimeConnection;
