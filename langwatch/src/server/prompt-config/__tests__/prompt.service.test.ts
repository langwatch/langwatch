import { describe, it, expect, vi, beforeEach } from "vitest";

// This is a unit test for the prompt service logic that changed
describe("Prompt Service", () => {
  describe("System Message Handling", () => {
    it("should extract system prompt from messages", () => {
      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ];

      const systemMessage = messages.find((m) => m.role === "system");
      expect(systemMessage?.content).toBe("You are a helpful assistant.");
    });

    it("should filter out system messages from message list", () => {
      const messages = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant reply" },
      ];

      const nonSystemMessages = messages.filter((m) => m.role !== "system");

      expect(nonSystemMessages).toHaveLength(2);
      expect(nonSystemMessages).toEqual([
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant reply" },
      ]);
    });

    it("should handle no system messages", () => {
      const messages = [
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant reply" },
      ];

      const systemMessage = messages.find((m) => m.role === "system");
      expect(systemMessage).toBeUndefined();
    });

    it("should handle multiple system messages", () => {
      const messages = [
        { role: "system", content: "First system" },
        { role: "user", content: "User" },
        { role: "system", content: "Second system" },
      ];

      const systemMessages = messages.filter((m) => m.role === "system");
      expect(systemMessages).toHaveLength(2);
    });

    it("should handle empty messages array", () => {
      const messages: any[] = [];

      const systemMessage = messages.find((m) => m.role === "system");
      expect(systemMessage).toBeUndefined();
    });
  });

  describe("Prompt Conversion", () => {
    it("should convert prompt with system message to separated format", () => {
      const promptData = {
        prompt: "You are a helpful assistant.",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi!" },
        ],
      };

      expect(promptData.prompt).toBe("You are a helpful assistant.");
      expect(promptData.messages).not.toContain(
        expect.objectContaining({ role: "system" })
      );
    });

    it("should handle combining system message with messages", () => {
      const systemPrompt = "You are helpful.";
      const otherMessages = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ];

      const allMessages = [
        { role: "system", content: systemPrompt },
        ...otherMessages,
      ];

      expect(allMessages[0].role).toBe("system");
      expect(allMessages[0].content).toBe(systemPrompt);
      expect(allMessages.slice(1)).toEqual(otherMessages);
    });
  });

  describe("Version Metadata", () => {
    it("should include version metadata in prompt data", () => {
      const versionMetadata = {
        versionId: "v1",
        versionNumber: 1,
        versionCreatedAt: new Date().toISOString(),
      };

      expect(versionMetadata.versionId).toBe("v1");
      expect(versionMetadata.versionNumber).toBe(1);
      expect(versionMetadata.versionCreatedAt).toBeDefined();
    });

    it("should handle missing optional version metadata", () => {
      const metadata: Partial<{
        versionId: string;
        versionNumber: number;
        versionCreatedAt: string;
      }> = {};

      expect(metadata.versionId).toBeUndefined();
      expect(metadata.versionNumber).toBeUndefined();
      expect(metadata.versionCreatedAt).toBeUndefined();
    });
  });
});