"use strict";
/**
 * Speech Engine namespace — provides event constants and classes for handling
 * incoming WebSocket connections from the ElevenLabs Speech Engine API.
 *
 * @example
 * ```typescript
 * import { SpeechEngine } from "@elevenlabs/elevenlabs-js";
 *
 * const session = new SpeechEngine.Session(ws);
 * session.on(SpeechEngine.USER_TRANSCRIPT, async (transcript, signal) => { ... });
 * ```
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = exports.Resource = exports.Attachment = exports.Server = exports.Session = exports.DISCONNECTED = exports.ERROR = exports.CLOSE = exports.USER_TRANSCRIPT = exports.INIT = void 0;
// -- Event name constants (use these with session.on) -------------------------
/** Fired when the session is initialized with a conversation ID. */
exports.INIT = "init";
/** Fired when the Speech Engine API sends a user transcript. */
exports.USER_TRANSCRIPT = "user_transcript";
/** Fired when the user disconnects the call. */
exports.CLOSE = "close";
/** Fired when an error occurs (protocol or WebSocket level). */
exports.ERROR = "error";
/** Fired when the underlying WebSocket connection drops. */
exports.DISCONNECTED = "disconnected";
// -- Re-exported classes ------------------------------------------------------
var SpeechEngineSession_1 = require("./SpeechEngineSession");
Object.defineProperty(exports, "Session", { enumerable: true, get: function () { return SpeechEngineSession_1.SpeechEngineSession; } });
var SpeechEngineServer_1 = require("./SpeechEngineServer");
Object.defineProperty(exports, "Server", { enumerable: true, get: function () { return SpeechEngineServer_1.SpeechEngineServer; } });
var SpeechEngineAttachment_1 = require("./SpeechEngineAttachment");
Object.defineProperty(exports, "Attachment", { enumerable: true, get: function () { return SpeechEngineAttachment_1.SpeechEngineAttachment; } });
var SpeechEngineResource_1 = require("./SpeechEngineResource");
Object.defineProperty(exports, "Resource", { enumerable: true, get: function () { return SpeechEngineResource_1.SpeechEngineResource; } });
var SpeechEngineClientWrapper_1 = require("./SpeechEngineClientWrapper");
Object.defineProperty(exports, "Client", { enumerable: true, get: function () { return SpeechEngineClientWrapper_1.SpeechEngineClientWrapper; } });
