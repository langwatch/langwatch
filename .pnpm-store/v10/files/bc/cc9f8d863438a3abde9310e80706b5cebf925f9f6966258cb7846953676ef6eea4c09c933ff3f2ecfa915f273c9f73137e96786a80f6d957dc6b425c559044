"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestConversation = createTestConversation;
const Conversation_1 = require("../Conversation");
const MockConversation_1 = require("./MockConversation");
const ClientTools_1 = require("../ClientTools");
function createTestConversation(options = {}) {
    const mockWebSocketFactory = new MockConversation_1.MockWebSocketFactory();
    const mockAudio = new MockConversation_1.MockAudioInterface();
    const mockClient = new MockConversation_1.MockConversationClient();
    const mockTools = new ClientTools_1.ClientTools();
    const conversation = new Conversation_1.Conversation({
        conversationClient: mockClient,
        webSocketFactory: mockWebSocketFactory,
        agentId: options.agentId || "test-agent-id",
        requiresAuth: options.requiresAuth || false,
        audioInterface: mockAudio,
        clientTools: mockTools,
        config: options.config,
    });
    return {
        conversation,
        mockWebSocket: mockWebSocketFactory.getMockWebSocket(),
        mockAudio,
        mockClient,
        mockTools,
    };
}
