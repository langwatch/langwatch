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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElevenLabsClient = void 0;
const Client_1 = require("../Client");
const errors = __importStar(require("../errors"));
const music_1 = require("./music");
const speech_engine_1 = require("./speech-engine");
const speechToText_1 = require("./speechToText");
const webhooks_1 = require("./webhooks");
class ElevenLabsClient extends Client_1.ElevenLabsClient {
    constructor(options = {}) {
        var _a;
        const apiKey = (_a = options.apiKey) !== null && _a !== void 0 ? _a : process.env.ELEVENLABS_API_KEY;
        if (apiKey == null) {
            throw new errors.ElevenLabsError({
                message: "Please pass in your ElevenLabs API Key or export ELEVENLABS_API_KEY in your environment.",
            });
        }
        options.apiKey = apiKey;
        super(options);
    }
    get webhooks() {
        if (!this._customWebhooks) {
            this._customWebhooks = new webhooks_1.WebhooksClient(this._options);
        }
        return this._customWebhooks;
    }
    get music() {
        if (!this._customMusic) {
            this._customMusic = new music_1.Music(this._options);
        }
        // Return wrapper Music cast as GeneratedMusic to maintain type compatibility
        // The wrapper has enhanced composeDetailed that returns MultipartResponse
        return this._customMusic;
    }
    get speechToText() {
        if (!this._customSpeechToText) {
            this._customSpeechToText = new speechToText_1.SpeechToText(this._options);
        }
        return this._customSpeechToText;
    }
    // @ts-expect-error — SpeechEngineClientWrapper.get() returns SpeechEngineResource, not HttpResponsePromise<SpeechEngineResponse>
    get speechEngine() {
        if (!this._customSpeechEngine) {
            this._customSpeechEngine = new speech_engine_1.SpeechEngineClientWrapper(this._options);
        }
        return this._customSpeechEngine;
    }
}
exports.ElevenLabsClient = ElevenLabsClient;
