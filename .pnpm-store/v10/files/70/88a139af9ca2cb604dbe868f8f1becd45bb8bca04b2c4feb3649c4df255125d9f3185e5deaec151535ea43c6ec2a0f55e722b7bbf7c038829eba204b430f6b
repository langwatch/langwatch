"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockConversationClient = exports.MockAudioInterface = exports.MockWebSocketFactory = exports.MockWebSocket = void 0;
const events_1 = require("events");
const AudioInterface_1 = require("../AudioInterface");
class MockWebSocket extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.readyState = 1; // OPEN
        this.mockMessages = [];
    }
    send(data) {
        // Store sent messages for verification
        this.mockMessages.push(JSON.parse(data));
    }
    close() {
        this.readyState = 3; // CLOSED
        this.emit("close", 1000, Buffer.from("Normal closure"));
    }
    // Helper methods for testing
    simulateMessage(message) {
        this.emit("message", JSON.stringify(message));
    }
    simulateError(error) {
        this.emit("error", error);
    }
    simulateOpen() {
        this.emit("open");
    }
    getSentMessages() {
        return [...this.mockMessages];
    }
    getLastMessage() {
        return this.mockMessages[this.mockMessages.length - 1];
    }
    clearMessages() {
        this.mockMessages = [];
    }
}
exports.MockWebSocket = MockWebSocket;
class MockWebSocketFactory {
    constructor() {
        this.mockWebSocket = new MockWebSocket();
    }
    create(url, options) {
        return this.mockWebSocket;
    }
    getMockWebSocket() {
        return this.mockWebSocket;
    }
}
exports.MockWebSocketFactory = MockWebSocketFactory;
class MockAudioInterface extends AudioInterface_1.AudioInterface {
    constructor() {
        super(...arguments);
        this.outputBuffer = [];
        this.isStarted = false;
    }
    start(inputCallback) {
        this.inputCallback = inputCallback;
        this.isStarted = true;
    }
    stop() {
        this.isStarted = false;
        this.inputCallback = undefined;
    }
    output(audio) {
        this.outputBuffer.push(audio);
    }
    interrupt() {
        this.outputBuffer = [];
    }
    // Helper methods for testing
    simulateAudioInput(audio) {
        if (this.inputCallback && this.isStarted) {
            this.inputCallback(audio);
        }
    }
    getOutputBuffer() {
        return [...this.outputBuffer];
    }
    clearOutputBuffer() {
        this.outputBuffer = [];
    }
    isAudioStarted() {
        return this.isStarted;
    }
}
exports.MockAudioInterface = MockAudioInterface;
class MockConversationClient {
    constructor() {
        this.mockSignedUrl = "wss://mock.elevenlabs.io/signed";
        this.conversationalAi = {
            conversations: {
                getSignedUrl: jest.fn().mockResolvedValue({
                    signedUrl: this.mockSignedUrl,
                }),
            },
        };
    }
    setMockSignedUrl(url) {
        this.mockSignedUrl = url;
        this.conversationalAi.conversations.getSignedUrl.mockResolvedValue({
            signedUrl: url,
        });
    }
}
exports.MockConversationClient = MockConversationClient;
