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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScribeRealtime = exports.CommitStrategy = exports.AudioFormat = void 0;
const ws_1 = __importDefault(require("ws"));
const connection_1 = require("./connection");
const core = __importStar(require("../../core"));
const environments = __importStar(require("../../environments"));
var AudioFormat;
(function (AudioFormat) {
    AudioFormat["PCM_8000"] = "pcm_8000";
    AudioFormat["PCM_16000"] = "pcm_16000";
    AudioFormat["PCM_22050"] = "pcm_22050";
    AudioFormat["PCM_24000"] = "pcm_24000";
    AudioFormat["PCM_44100"] = "pcm_44100";
    AudioFormat["PCM_48000"] = "pcm_48000";
    AudioFormat["ULAW_8000"] = "ulaw_8000";
})(AudioFormat || (exports.AudioFormat = AudioFormat = {}));
var CommitStrategy;
(function (CommitStrategy) {
    CommitStrategy["MANUAL"] = "manual";
    CommitStrategy["VAD"] = "vad";
})(CommitStrategy || (exports.CommitStrategy = CommitStrategy = {}));
/**
 * Real-time speech-to-text transcription client.
 * @remarks
 * **Node.js only**: This class uses Node.js-specific APIs (WebSocket from 'ws', child_process).
 * It will not work in browsers, Deno, or Cloudflare Workers without modifications.
 */
class ScribeRealtime {
    constructor(options = {}) {
        this.options = options;
    }
    getWebSocketUri() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            // Get base URL from options, preferring baseUrl, then environment, then default Production
            const baseUrl = (_b = (_a = (yield core.Supplier.get(this.options.baseUrl))) !== null && _a !== void 0 ? _a : (yield core.Supplier.get(this.options.environment))) !== null && _b !== void 0 ? _b : environments.ElevenLabsEnvironment.Production;
            // Convert HTTP(S) to WS(S)
            const wsUrl = baseUrl.replace(/^https?:\/\//i, (match) => match.toLowerCase() === "https://" ? "wss://" : "ws://");
            return `${wsUrl}/v1/speech-to-text/realtime`;
        });
    }
    checkFfmpegInstalled() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { execSync } = yield Promise.resolve().then(() => __importStar(require("node:child_process")));
                const command = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
                execSync(command, { stdio: "ignore" });
            }
            catch (_a) {
                throw new Error("ffmpeg is required for URL streaming but was not found. " +
                    "Please install ffmpeg and ensure it is available in your PATH. " +
                    "Visit https://ffmpeg.org/download.html for installation instructions.");
            }
        });
    }
    buildWebSocketUri(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const baseUri = yield this.getWebSocketUri();
            const params = new URLSearchParams();
            // Model ID is required, so no check required
            params.append("model_id", options.modelId);
            // Add optional parameters if provided, with validation
            if (options.commitStrategy !== undefined) {
                params.append("commit_strategy", options.commitStrategy);
            }
            if (options.audioFormat !== undefined) {
                params.append("audio_format", options.audioFormat);
            }
            if (options.vadSilenceThresholdSecs !== undefined) {
                if (options.vadSilenceThresholdSecs <= 0.3 || options.vadSilenceThresholdSecs > 3.0) {
                    throw new Error("vadSilenceThresholdSecs must be between 0.3 and 3.0");
                }
                params.append("vad_silence_threshold_secs", options.vadSilenceThresholdSecs.toString());
            }
            if (options.vadThreshold !== undefined) {
                if (options.vadThreshold < 0.1 || options.vadThreshold > 0.9) {
                    throw new Error("vadThreshold must be between 0.1 and 0.9");
                }
                params.append("vad_threshold", options.vadThreshold.toString());
            }
            if (options.minSpeechDurationMs !== undefined) {
                if (options.minSpeechDurationMs <= 50 || options.minSpeechDurationMs > 2000) {
                    throw new Error("minSpeechDurationMs must be between 50 and 2000");
                }
                params.append("min_speech_duration_ms", options.minSpeechDurationMs.toString());
            }
            if (options.minSilenceDurationMs !== undefined) {
                if (options.minSilenceDurationMs <= 50 || options.minSilenceDurationMs > 2000) {
                    throw new Error("minSilenceDurationMs must be between 50 and 2000");
                }
                params.append("min_silence_duration_ms", options.minSilenceDurationMs.toString());
            }
            if (options.languageCode !== undefined) {
                params.append("language_code", options.languageCode);
            }
            if (options.includeTimestamps !== undefined) {
                params.append("include_timestamps", options.includeTimestamps.toString());
            }
            if (options.keyterms !== undefined) {
                for (const term of options.keyterms) {
                    params.append("keyterms", term);
                }
            }
            if (options.noVerbatim !== undefined) {
                params.append("no_verbatim", options.noVerbatim ? "true" : "false");
            }
            if (options.audioFormat !== undefined) {
                params.append("audio_format", options.audioFormat);
            }
            const queryString = params.toString();
            return queryString ? `${baseUri}?${queryString}` : baseUri;
        });
    }
    /**
     * Establishes a WebSocket connection for real-time speech-to-text transcription.
     *
     * @param options - Configuration options for the connection
     * @returns A promise that resolves to a RealtimeConnection instance
     *
     * @remarks
     * **Node.js only**: This method uses Node.js-specific APIs.
     *
     * When using `UrlOptions` with a URL, ffmpeg must be installed and available in PATH.
     * The SDK will automatically convert the stream to 16kHz mono PCM format.
     *
     * @example
     * ```typescript
     * // Manual audio streaming
     * const connection = await client.speechToText.realtime.connect({
     *     modelId: "scribe_v2_realtime",
     *     audioFormat: AudioFormat.PCM_16000,
     *     sampleRate: 16000,
     * });
     *
     * // Automatic URL streaming (requires ffmpeg)
     * const connection = await client.speechToText.realtime.connect({
     *     modelId: "scribe_v2_realtime",
     *     url: "https://example.com/stream.mp3",
     * });
     * ```
     */
    connect(options) {
        return __awaiter(this, void 0, void 0, function* () {
            let apiKey = this.options.apiKey;
            if (!apiKey) {
                throw new Error("API key is required");
            }
            // Resolve API key if it's a function or promise
            if (typeof apiKey === "function") {
                apiKey = apiKey();
            }
            if (apiKey instanceof Promise) {
                apiKey = yield apiKey;
            }
            if (!apiKey) {
                throw new Error("API key is required");
            }
            if (!options.modelId) {
                throw new Error("modelId is required");
            }
            // Create connection object first so users can attach event listeners before messages arrive
            const sampleRate = "url" in options ? 16000 : options.sampleRate;
            const connection = new connection_1.RealtimeConnection(sampleRate);
            // Build WebSocket URI with query parameters
            const uri = yield this.buildWebSocketUri(options);
            return new Promise((resolve) => {
                const websocket = new ws_1.default(uri, {
                    headers: {
                        "xi-api-key": apiKey,
                    },
                });
                // Attach websocket to connection immediately so error handlers are registered
                // This ensures errors during handshake (like 403) are properly emitted via event emitter
                connection.setWebSocket(websocket);
                // Resolve immediately with connection so users can attach listeners
                resolve(connection);
                websocket.on("open", () => {
                    var _a;
                    // If UrlOptions, start streaming from URL with ffmpeg
                    if ("url" in options) {
                        const commitStrategy = (_a = options.commitStrategy) !== null && _a !== void 0 ? _a : CommitStrategy.MANUAL;
                        this.streamFromUrl(options, connection, commitStrategy);
                    }
                });
            });
        });
    }
    streamFromUrl(options, connection, commitStrategy) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            // Check if ffmpeg is installed before attempting to use it
            yield this.checkFfmpegInstalled();
            // Dynamically import spawn to avoid bundling issues in non-Node.js environments
            const { spawn } = yield Promise.resolve().then(() => __importStar(require("node:child_process")));
            // Spawn ffmpeg to convert the stream to 16kHz mono PCM
            const ffmpegProcess = spawn("ffmpeg", [
                "-i", options.url,
                "-f", "s16le", // 16-bit PCM, little-endian
                "-acodec", "pcm_s16le", // PCM codec
                "-ar", "16000", // 16kHz sample rate
                "-ac", "1", // mono (1 channel)
                "pipe:1" // output to stdout
            ]);
            connection.setFfmpegProcess(ffmpegProcess);
            (_a = ffmpegProcess.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (chunk) => {
                const base64Audio = chunk.toString("base64");
                connection.send({
                    audioBase64: base64Audio,
                });
            });
            (_b = ffmpegProcess.stdout) === null || _b === void 0 ? void 0 : _b.on("end", () => {
                if (commitStrategy === CommitStrategy.MANUAL) {
                    // Manual strategy: commit to process segment transcription, then close
                    console.log("Stream ended, committing segment");
                    connection.commit();
                }
                // Close connection since no more audio will be sent
                connection.close();
            });
            (_c = ffmpegProcess.stderr) === null || _c === void 0 ? void 0 : _c.on("data", (data) => {
                // ffmpeg outputs progress info to stderr, only log errors
                const message = data.toString();
                if (message.includes("Error") || message.includes("error")) {
                    console.error("ffmpeg error:", message);
                }
            });
            ffmpegProcess.on("error", (error) => {
                console.error("Failed to start ffmpeg:", error);
            });
            ffmpegProcess.on("close", (code) => {
                console.log(`ffmpeg process exited with code ${code}`);
            });
        });
    }
}
exports.ScribeRealtime = ScribeRealtime;
