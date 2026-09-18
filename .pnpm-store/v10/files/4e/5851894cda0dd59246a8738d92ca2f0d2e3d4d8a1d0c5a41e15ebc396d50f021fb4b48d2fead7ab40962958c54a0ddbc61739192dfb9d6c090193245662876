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
exports.SpeechEngineClientWrapper = void 0;
const Client_1 = require("../../api/resources/speechEngine/client/Client");
const SpeechEngineResource_1 = require("./SpeechEngineResource");
/**
 * Client for the Speech Engine resource. Accessible via `elevenlabs.speechEngine`.
 *
 * Extends the Fern-generated `SpeechEngineClient` with WebSocket integration
 * methods. `list` and `delete` are inherited from the generated client.
 * `create`, `get`, and `update` are overridden to return a `SpeechEngineResource`
 * with WebSocket server setup methods.
 *
 * @example
 * ```typescript
 * // Create a speech engine and immediately attach it
 * const engine = await elevenlabs.speechEngine.create({
 *     name: "My engine",
 *     speechEngine: { wsUrl: "wss://your-server.com/ws" },
 * });
 * engine.attach(httpServer, "/api/speech-engine/ws", {
 *     async onTranscript(transcript, signal, session) {
 *         session.sendResponse(await llm.generate(transcript, { signal }));
 *     },
 * });
 * ```
 */
class SpeechEngineClientWrapper extends Client_1.SpeechEngineClient {
    /**
     * Create a Speech Engine and return a `SpeechEngineResource`.
     *
     * Makes an API call to create the engine, then returns a
     * `SpeechEngineResource` with `.attach()`, `.createSession()`, and
     * `.verifyRequest()` methods for setting up a WebSocket server.
     *
     * @example
     * ```typescript
     * const engine = await elevenlabs.speechEngine.create({
     *     name: "My engine",
     *     speechEngine: { wsUrl: "wss://your-server.com/ws" },
     * });
     * engine.attach(httpServer, "/api/speech-engine/ws", {
     *     async onTranscript(transcript, signal, session) {
     *         session.sendResponse(await llm.generate(transcript, { signal }));
     *     },
     * });
     * ```
     */
    // @ts-expect-error — intentionally returns SpeechEngineResource instead of HttpResponsePromise<SpeechEngineResponse>
    create(request, requestOptions) {
        const _super = Object.create(null, {
            create: { get: () => super.create }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield _super.create.call(this, request, requestOptions);
            return new SpeechEngineResource_1.SpeechEngineResource(response.speechEngineId, this._options, response);
        });
    }
    /**
     * Fetch a Speech Engine by ID and return a `SpeechEngineResource`.
     *
     * Makes an API call to validate the engine exists, then returns a
     * `SpeechEngineResource` with `.attach()`, `.createSession()`, and
     * `.verifyRequest()` methods for setting up a WebSocket server.
     *
     * @example
     * ```typescript
     * const engine = await elevenlabs.speechEngine.get("seng_123");
     * engine.attach(httpServer, "/api/speech-engine/ws", {
     *     async onTranscript(transcript, signal, session) {
     *         session.sendResponse(await llm.generate(transcript, { signal }));
     *     },
     * });
     * ```
     */
    // @ts-expect-error — intentionally returns SpeechEngineResource instead of HttpResponsePromise<SpeechEngineResponse>
    get(speechEngineId, requestOptions) {
        const _super = Object.create(null, {
            get: { get: () => super.get }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield _super.get.call(this, speechEngineId, requestOptions);
            return new SpeechEngineResource_1.SpeechEngineResource(speechEngineId, this._options, response);
        });
    }
    /**
     * Update a Speech Engine and return a `SpeechEngineResource`.
     *
     * Makes an API call to update the engine, then returns a
     * `SpeechEngineResource` with `.attach()`, `.createSession()`, and
     * `.verifyRequest()` methods for setting up a WebSocket server.
     *
     * @example
     * ```typescript
     * const engine = await elevenlabs.speechEngine.update("seng_123", { name: "Renamed" });
     * engine.attach(httpServer, "/api/speech-engine/ws", {
     *     async onTranscript(transcript, signal, session) {
     *         session.sendResponse(await llm.generate(transcript, { signal }));
     *     },
     * });
     * ```
     */
    // @ts-expect-error — intentionally returns SpeechEngineResource instead of HttpResponsePromise<SpeechEngineResponse>
    update(speechEngineId_1) {
        const _super = Object.create(null, {
            update: { get: () => super.update }
        });
        return __awaiter(this, arguments, void 0, function* (speechEngineId, request = {}, requestOptions) {
            const response = yield _super.update.call(this, speechEngineId, request, requestOptions);
            return new SpeechEngineResource_1.SpeechEngineResource(speechEngineId, this._options, response);
        });
    }
    /**
     * Shortcut: attach a Speech Engine to an HTTP server without making an
     * API call. Equivalent to constructing a `SpeechEngineResource` and calling
     * `attach()` on it directly.
     *
     * @example
     * ```typescript
     * elevenlabs.speechEngine.attach("seng_123", httpServer, "/api/se/ws", {
     *     async onTranscript(transcript, signal, session) {
     *         session.sendResponse(await llm.generate(transcript, { signal }));
     *     },
     * });
     * ```
     */
    attach(engineId, httpServer, path, handler) {
        return new SpeechEngineResource_1.SpeechEngineResource(engineId, this._options).attach(httpServer, path, handler);
    }
}
exports.SpeechEngineClientWrapper = SpeechEngineClientWrapper;
