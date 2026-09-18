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
const Conversation_1 = require("../Conversation");
const AudioInterface_1 = require("../AudioInterface");
const ClientTools_1 = require("../ClientTools");
// Mock WebSocket
jest.mock("ws", () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1, // OPEN
        OPEN: 1,
    }));
});
// Mock ElevenLabsClient
const mockClient = {
    conversationalAi: {
        conversations: {
            getSignedUrl: jest.fn().mockResolvedValue({ signedUrl: "wss://test.com/signed" }),
        },
    },
};
// Mock AudioInterface
class MockAudioInterface extends AudioInterface_1.AudioInterface {
    start(inputCallback) {
        this.inputCallback = inputCallback;
    }
    stop() {
        this.inputCallback = undefined;
    }
    output(audio) {
        // Mock output
    }
    interrupt() {
        // Mock interrupt
    }
    simulateInput(audio) {
        if (this.inputCallback) {
            this.inputCallback(audio);
        }
    }
}
describe("Conversation", () => {
    let conversation;
    let mockAudioInterface;
    let mockClientTools;
    let mockWebSocket;
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        // Create mock instances
        mockAudioInterface = new MockAudioInterface();
        mockClientTools = new ClientTools_1.ClientTools();
        // Mock WebSocket constructor
        const WebSocket = require("ws");
        mockWebSocket = {
            on: jest.fn(),
            send: jest.fn(),
            close: jest.fn(),
            readyState: 1, // OPEN
        };
        WebSocket.mockImplementation(() => mockWebSocket);
        WebSocket.OPEN = 1;
        // Create conversation instance
        conversation = new Conversation_1.Conversation({
            client: mockClient,
            agentId: "test-agent-id",
            requiresAuth: false,
            audioInterface: mockAudioInterface,
            clientTools: mockClientTools,
        });
    });
    afterEach(() => {
        conversation.endSession();
    });
    describe("constructor", () => {
        it("should initialize with correct properties", () => {
            expect(conversation.getConversationId()).toBeUndefined();
            expect(conversation.isSessionActive()).toBe(false);
        });
        it("should accept callback functions", () => {
            const agentResponseCallback = jest.fn();
            const userTranscriptCallback = jest.fn();
            const conversationWithCallbacks = new Conversation_1.Conversation({
                client: mockClient,
                agentId: "test-agent-id",
                requiresAuth: false,
                audioInterface: mockAudioInterface,
                callbackAgentResponse: agentResponseCallback,
                callbackUserTranscript: userTranscriptCallback,
            });
            expect(conversationWithCallbacks).toBeDefined();
        });
    });
    describe("startSession", () => {
        it("should start a session without auth", () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock WebSocket events
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            expect(mockWebSocket.on).toHaveBeenCalledWith("open", expect.any(Function));
            expect(mockWebSocket.on).toHaveBeenCalledWith("message", expect.any(Function));
            expect(mockWebSocket.on).toHaveBeenCalledWith("error", expect.any(Function));
            expect(mockWebSocket.on).toHaveBeenCalledWith("close", expect.any(Function));
        }));
        it("should start a session with auth", () => __awaiter(void 0, void 0, void 0, function* () {
            const authConversation = new Conversation_1.Conversation({
                client: mockClient,
                agentId: "test-agent-id",
                requiresAuth: true,
                audioInterface: mockAudioInterface,
            });
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield authConversation.startSession();
            expect(mockClient.conversationalAi.conversations.getSignedUrl).toHaveBeenCalledWith({
                agentId: "test-agent-id",
            });
        }));
        it("should throw error if session already started", () => __awaiter(void 0, void 0, void 0, function* () {
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            yield expect(conversation.startSession()).rejects.toThrow("Session already started");
        }));
    });
    describe("message handling", () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
        }));
        it("should send user messages", () => {
            conversation.sendUserMessage("Hello, how are you?");
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "user_message",
                text: "Hello, how are you?",
            }));
        });
        it("should register user activity", () => {
            conversation.registerUserActivity();
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "user_activity",
            }));
        });
        it("should send contextual updates", () => {
            conversation.sendContextualUpdate("User is looking at product page");
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "contextual_update",
                text: "User is looking at product page",
            }));
        });
        it("should send multimodal message with text and file", () => {
            conversation.sendMultimodalMessage({ text: "What is in this file?", fileId: "file_abc123" });
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "multimodal_message",
                text: { type: "user_message", text: "What is in this file?" },
                file: { type: "file_input", file_id: "file_abc123" },
            }));
        });
        it("should send multimodal message with text only", () => {
            conversation.sendMultimodalMessage({ text: "Hello" });
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "multimodal_message",
                text: { type: "user_message", text: "Hello" },
            }));
        });
        it("should send multimodal message with file only", () => {
            conversation.sendMultimodalMessage({ fileId: "file_abc123" });
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "multimodal_message",
                file: { type: "file_input", file_id: "file_abc123" },
            }));
        });
        it("should throw error when sending multimodal message without text or fileId", () => {
            expect(() => conversation.sendMultimodalMessage({})).toThrow("At least one of text or fileId must be provided");
        });
        it("should throw error when sending message without active session", () => {
            conversation.endSession();
            expect(() => conversation.sendUserMessage("test")).toThrow("Session not started or websocket not connected");
        });
    });
    describe("message receiving", () => {
        let messageHandler;
        let agentResponseCallback;
        let userTranscriptCallback;
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            agentResponseCallback = jest.fn();
            userTranscriptCallback = jest.fn();
            conversation = new Conversation_1.Conversation({
                client: mockClient,
                agentId: "test-agent-id",
                requiresAuth: false,
                audioInterface: mockAudioInterface,
                callbackAgentResponse: agentResponseCallback,
                callbackUserTranscript: userTranscriptCallback,
            });
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
                else if (event === "message") {
                    messageHandler = callback;
                }
            });
            yield conversation.startSession();
        }));
        it("should handle conversation initiation metadata", () => {
            const message = {
                type: "conversation_initiation_metadata",
                conversation_initiation_metadata_event: {
                    conversation_id: "test-conversation-123",
                },
            };
            messageHandler(Buffer.from(JSON.stringify(message)));
            expect(conversation.getConversationId()).toBe("test-conversation-123");
        });
        it("should handle agent responses", () => {
            const message = {
                type: "agent_response",
                agent_response_event: {
                    agent_response: "  Hello! How can I help you today?  ",
                },
            };
            messageHandler(Buffer.from(JSON.stringify(message)));
            expect(agentResponseCallback).toHaveBeenCalledWith("Hello! How can I help you today?");
        });
        it("should handle user transcripts", () => {
            const message = {
                type: "user_transcript",
                user_transcription_event: {
                    user_transcript: "  Hello, I need help  ",
                },
            };
            messageHandler(Buffer.from(JSON.stringify(message)));
            expect(userTranscriptCallback).toHaveBeenCalledWith("Hello, I need help");
        });
        it("should handle audio messages", () => {
            const audioData = Buffer.from("test audio data").toString("base64");
            const message = {
                type: "audio",
                audio_event: {
                    event_id: "1",
                    audio_base_64: audioData,
                },
            };
            const outputSpy = jest.spyOn(mockAudioInterface, "output");
            messageHandler(Buffer.from(JSON.stringify(message)));
            expect(outputSpy).toHaveBeenCalledWith(Buffer.from("test audio data"));
        });
        it("should handle ping messages", () => {
            const message = {
                type: "ping",
                ping_event: {
                    event_id: "ping-123",
                    ping_ms: "50",
                },
            };
            messageHandler(Buffer.from(JSON.stringify(message)));
            expect(mockWebSocket.send).toHaveBeenCalledWith(JSON.stringify({
                type: "pong",
                event_id: "ping-123",
            }));
        });
    });
    describe("client tools integration", () => {
        let messageHandler;
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
                else if (event === "message") {
                    messageHandler = callback;
                }
            });
            yield conversation.startSession();
        }));
        it("should handle client tool calls", () => __awaiter(void 0, void 0, void 0, function* () {
            // Register a test tool
            mockClientTools.register("test_tool", (params) => {
                return `Tool called with: ${params.input}`;
            });
            const message = {
                type: "client_tool_call",
                client_tool_call: {
                    tool_name: "test_tool",
                    tool_call_id: "call-123",
                    parameters: {
                        input: "test input",
                    },
                },
            };
            messageHandler(Buffer.from(JSON.stringify(message)));
            // Wait for async tool execution
            yield new Promise((resolve) => setTimeout(resolve, 10));
            expect(mockWebSocket.send).toHaveBeenLastCalledWith(JSON.stringify({
                type: "client_tool_result",
                tool_call_id: "call-123",
                result: "Tool called with: test input",
                is_error: false,
            }));
        }));
    });
    describe("session management", () => {
        it("should properly end session", () => __awaiter(void 0, void 0, void 0, function* () {
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            // Wait for session to be fully started
            yield new Promise((resolve) => setTimeout(resolve, 10));
            expect(conversation.isSessionActive()).toBe(true);
            conversation.endSession();
            expect(conversation.isSessionActive()).toBe(false);
            expect(mockWebSocket.close).toHaveBeenCalled();
        }));
        it("should emit session events", () => __awaiter(void 0, void 0, void 0, function* () {
            const sessionStartedSpy = jest.fn();
            const sessionEndedSpy = jest.fn();
            conversation.on("session_started", sessionStartedSpy);
            conversation.on("session_ended", sessionEndedSpy);
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            conversation.endSession();
            // Wait for events to be emitted
            yield new Promise((resolve) => setTimeout(resolve, 10));
            expect(sessionStartedSpy).toHaveBeenCalled();
            expect(sessionEndedSpy).toHaveBeenCalled();
        }));
    });
    describe("audio integration", () => {
        it("should start audio interface on session start", () => __awaiter(void 0, void 0, void 0, function* () {
            const startSpy = jest.spyOn(mockAudioInterface, "start");
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            expect(startSpy).toHaveBeenCalled();
        }));
        it("should stop audio interface on session end", () => __awaiter(void 0, void 0, void 0, function* () {
            const stopSpy = jest.spyOn(mockAudioInterface, "stop");
            mockWebSocket.on.mockImplementation((event, callback) => {
                if (event === "open") {
                    setTimeout(() => callback(), 0);
                }
            });
            yield conversation.startSession();
            conversation.endSession();
            expect(stopSpy).toHaveBeenCalled();
        }));
    });
});
