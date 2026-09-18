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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Conversation = void 0;
const events_1 = require("events");
const ws_1 = __importDefault(require("ws"));
const Client_1 = require("../../../../Client");
const version_1 = require("../../../../version");
const ClientTools_1 = require("./ClientTools");
const events_2 = require("./events");
const WebSocketInterface_1 = require("./interfaces/WebSocketInterface");
/**
 * Conversational AI session for Node.js.
 *
 * BETA: This API is subject to change without regard to backwards compatibility.
 */
class Conversation extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.shouldStop = false;
        this.lastInterruptId = 0;
        this.client = options.client || new Client_1.ElevenLabsClient();
        this.agentId = options.agentId;
        this.requiresAuth = options.requiresAuth;
        this.audioInterface = options.audioInterface;
        this.clientTools = options.clientTools || new ClientTools_1.ClientTools();
        this.config = options.config || { extraBody: {}, conversationConfigOverride: {}, dynamicVariables: {} };
        this.conversationClient = options.conversationClient || this.client;
        this.webSocketFactory = options.webSocketFactory || new WebSocketInterface_1.DefaultWebSocketFactory();
        this.callbackAgentResponse = options.callbackAgentResponse;
        this.callbackAgentResponseCorrection = options.callbackAgentResponseCorrection;
        this.callbackUserTranscript = options.callbackUserTranscript;
        this.callbackLatencyMeasurement = options.callbackLatencyMeasurement;
        this.callbackMessageReceived = options.callbackMessageReceived;
    }
    /**
     * Starts the conversation session.
     *
     * Will run until `endSession` is called.
     */
    startSession() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.ws) {
                throw new Error("Session already started");
            }
            const wsUrl = this.requiresAuth ? yield this._getSignedUrl() : this._getWssUrl();
            return new Promise((resolve, reject) => {
                this.ws = this.webSocketFactory.create(wsUrl, {
                    perMessageDeflate: false,
                    maxPayload: 16 * 1024 * 1024, // 16MB max message size
                });
                this.ws.on("open", () => {
                    this._onWebSocketOpen();
                    resolve();
                });
                this.ws.on("message", (data) => {
                    this._onWebSocketMessage(data);
                });
                this.ws.on("error", (error) => {
                    this.emit("error", error);
                    reject(error);
                });
                this.ws.on("close", (code, reason) => {
                    this._onWebSocketClose(code, reason);
                });
            });
        });
    }
    /**
     * Ends the conversation session and cleans up resources.
     */
    endSession() {
        this.shouldStop = true;
        if (this.audioInterface) {
            this.audioInterface.stop();
        }
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
        this.emit("session_ended", this.conversationId);
    }
    /**
     * Send a text message from the user to the agent.
     *
     * @param text The text message to send to the agent
     */
    sendUserMessage(text) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("Session not started or websocket not connected");
        }
        const event = {
            type: events_2.ClientToOrchestratorEvent.USER_MESSAGE,
            text,
        };
        this.ws.send(JSON.stringify(event));
    }
    /**
     * Register user activity to prevent session timeout.
     *
     * This sends a ping to the orchestrator to reset the timeout timer.
     */
    registerUserActivity() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("Session not started or websocket not connected");
        }
        const event = {
            type: events_2.ClientToOrchestratorEvent.USER_ACTIVITY,
        };
        this.ws.send(JSON.stringify(event));
    }
    /**
     * Send a multimodal message combining text and a file reference to the agent.
     *
     * At least one of `text` or `fileId` must be provided.
     *
     * @param options.text Optional text message to include
     * @param options.fileId Optional ElevenLabs file ID to include
     */
    sendMultimodalMessage(options) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("Session not started or websocket not connected");
        }
        if (!options.text && !options.fileId) {
            throw new Error("At least one of text or fileId must be provided");
        }
        const event = Object.assign(Object.assign({ type: events_2.ClientToOrchestratorEvent.MULTIMODAL_MESSAGE }, (options.text && { text: { type: events_2.ClientToOrchestratorEvent.USER_MESSAGE, text: options.text } })), (options.fileId && { file: { type: "file_input", file_id: options.fileId } }));
        this.ws.send(JSON.stringify(event));
    }
    /**
     * Send a contextual update to the conversation.
     *
     * Contextual updates are non-interrupting content that is sent to the server
     * to update the conversation state without directly prompting the agent.
     *
     * @param text The contextual information to send to the conversation
     */
    sendContextualUpdate(text) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN) {
            throw new Error("Session not started or websocket not connected");
        }
        const event = {
            type: events_2.ClientToOrchestratorEvent.CONTEXTUAL_UPDATE,
            text,
        };
        this.ws.send(JSON.stringify(event));
    }
    /**
     * Get the conversation ID if available.
     *
     * @returns The conversation ID or undefined if not yet available
     */
    getConversationId() {
        return this.conversationId;
    }
    /**
     * Check if the session is currently active.
     *
     * @returns True if the session is active
     */
    isSessionActive() {
        return !!this.ws && this.ws.readyState === ws_1.default.OPEN && !this.shouldStop;
    }
    _onWebSocketOpen() {
        // Send conversation initiation data
        const initEvent = {
            type: events_2.ClientToOrchestratorEvent.CONVERSATION_INITIATION_CLIENT_DATA,
            custom_llm_extra_body: this.config.extraBody,
            conversation_config_override: this.config.conversationConfigOverride,
            dynamic_variables: this.config.dynamicVariables,
            environment: this.config.environment,
        };
        this.ws.send(JSON.stringify(initEvent));
        // Set up audio input callback
        this.inputCallback = (audio) => {
            if (this.shouldStop || !this.ws || this.ws.readyState !== ws_1.default.OPEN) {
                return;
            }
            try {
                const audioEvent = {
                    user_audio_chunk: audio.toString("base64"),
                };
                this.ws.send(JSON.stringify(audioEvent));
            }
            catch (error) {
                console.error("Error sending user audio chunk:", error);
                this.endSession();
            }
        };
        // Start audio interface
        this.audioInterface.start(this.inputCallback);
        this.emit("session_started");
    }
    _onWebSocketMessage(data) {
        if (this.shouldStop) {
            return;
        }
        try {
            const message = JSON.parse(data.toString());
            this._handleMessage(message);
        }
        catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
    }
    _onWebSocketClose(code, reason) {
        this.emit("session_ended", this.conversationId, code, reason.toString());
    }
    _handleMessage(message) {
        const messageType = message.type;
        switch (messageType) {
            case "conversation_initiation_metadata":
                const event = message.conversation_initiation_metadata_event;
                if (!this.conversationId) {
                    this.conversationId = event.conversation_id;
                    this.emit("conversation_started", this.conversationId);
                }
                break;
            case "audio":
                const audioEvent = message.audio_event;
                if (parseInt(audioEvent.event_id) <= this.lastInterruptId) {
                    return;
                }
                const audio = Buffer.from(audioEvent.audio_base_64, "base64");
                this.audioInterface.output(audio);
                break;
            case "agent_response":
                if (this.callbackAgentResponse) {
                    const responseEvent = message.agent_response_event;
                    this.callbackAgentResponse(responseEvent.agent_response.trim());
                }
                break;
            case "agent_response_correction":
                if (this.callbackAgentResponseCorrection) {
                    const correctionEvent = message.agent_response_correction_event;
                    this.callbackAgentResponseCorrection(correctionEvent.original_agent_response.trim(), correctionEvent.corrected_agent_response.trim());
                }
                break;
            case "user_transcript":
                if (this.callbackUserTranscript) {
                    const transcriptEvent = message.user_transcription_event;
                    this.callbackUserTranscript(transcriptEvent.user_transcript.trim());
                }
                break;
            case "interruption":
                const interruptionEvent = message.interruption_event;
                this.lastInterruptId = parseInt(interruptionEvent.event_id);
                this.audioInterface.interrupt();
                break;
            case "ping":
                const pingEvent = message.ping_event;
                const pongEvent = {
                    type: events_2.ClientToOrchestratorEvent.PONG,
                    event_id: pingEvent.event_id,
                };
                this.ws.send(JSON.stringify(pongEvent));
                if (this.callbackLatencyMeasurement && pingEvent.ping_ms) {
                    this.callbackLatencyMeasurement(parseInt(pingEvent.ping_ms));
                }
                break;
            case "client_tool_call":
                const toolCall = message.client_tool_call;
                const toolName = toolCall.tool_name;
                const parameters = Object.assign({ tool_call_id: toolCall.tool_call_id }, toolCall.parameters);
                this.clientTools.executeToolAsync(toolName, parameters, (response) => {
                    if (!this.shouldStop && this.ws && this.ws.readyState === ws_1.default.OPEN) {
                        this.ws.send(JSON.stringify(response));
                    }
                });
                break;
            default:
                // Ignore unknown message types
                break;
        }
        if (this.callbackMessageReceived) {
            this.callbackMessageReceived(message);
        }
    }
    _getWssUrl() {
        // Default to production environment WebSocket URL
        const baseWsUrl = "wss://api.elevenlabs.io";
        return `${baseWsUrl}/v1/convai/conversation?agent_id=${this.agentId}&source=js_sdk&version=${version_1.SDK_VERSION}`;
    }
    _getSignedUrl() {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.conversationClient.conversationalAi.conversations.getSignedUrl({
                agentId: this.agentId,
            });
            const signedUrl = response.signedUrl;
            const separator = signedUrl.includes("?") ? "&" : "?";
            return `${signedUrl}${separator}source=js_sdk&version=${version_1.SDK_VERSION}`;
        });
    }
}
exports.Conversation = Conversation;
