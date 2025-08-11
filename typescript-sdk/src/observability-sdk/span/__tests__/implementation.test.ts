import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { SpanStatusCode } from "@opentelemetry/api";
import { createLangWatchSpan } from "../implementation";
import { type ChatMessage, type SpanInputOutput } from "../../../internal/generated/types/tracer";
import { type Prompt } from "@/client-sdk/services/prompts";

// Mock OpenTelemetry Span
const createMockSpan = () => ({
  setAttribute: vi.fn().mockReturnThis(),
  setAttributes: vi.fn().mockReturnThis(),
  addEvent: vi.fn().mockReturnThis(),
  recordException: vi.fn().mockReturnThis(),
  setStatus: vi.fn().mockReturnThis(),
  updateName: vi.fn().mockReturnThis(),
  end: vi.fn(),
  isRecording: vi.fn().mockReturnValue(true),
  spanContext: vi.fn().mockReturnValue({}),
  addLink: vi.fn().mockReturnThis(),
  addLinks: vi.fn().mockReturnThis(),
});

describe("LangWatchSpan Implementation", () => {
  let mockSpan: ReturnType<typeof createMockSpan>;
  let langwatchSpan: ReturnType<typeof createLangWatchSpan>;

  beforeEach(() => {
    mockSpan = createMockSpan();
    langwatchSpan = createLangWatchSpan(mockSpan as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("setInput method overloads", () => {
    it("should handle explicit text type", () => {
      const result = langwatchSpan.setInput("text", "Hello world");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"text"')
      );
    });

    it("should handle explicit raw type", () => {
      const obj = { key: "value" };
      const result = langwatchSpan.setInput("raw", obj);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"raw"')
      );
    });

    it("should handle explicit chat_messages type", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi!" }
      ];
      const result = langwatchSpan.setInput("chat_messages", messages);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"chat_messages"')
      );
    });

    it("should handle explicit list type", () => {
      const list: SpanInputOutput[] = [
        { type: "text", value: "Item 1" },
        { type: "text", value: "Item 2" }
      ];
      const result = langwatchSpan.setInput("list", list);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"list"')
      );
    });

    it("should handle explicit json type", () => {
      const data = { key: "value", number: 42 };
      const result = langwatchSpan.setInput("json", data);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"json"')
      );
    });

    it("should handle auto-detection (single parameter)", () => {
      const result = langwatchSpan.setInput("Hello world");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"text"')
      );
    });

    it("should handle auto-detection for objects", () => {
      const obj = { key: "value" };
      const result = langwatchSpan.setInput(obj);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"json"')
      );
    });

    it("should handle auto-detection for arrays", () => {
      const arr = ["item1", "item2"];
      const result = langwatchSpan.setInput(arr);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"list"')
      );
    });
  });

  describe("setOutput method overloads", () => {
    it("should handle explicit text type", () => {
      const result = langwatchSpan.setOutput("text", "Response");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"text"')
      );
    });

    it("should handle explicit raw type", () => {
      const obj = { response: "data" };
      const result = langwatchSpan.setOutput("raw", obj);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"raw"')
      );
    });

    it("should handle explicit chat_messages type", () => {
      const messages: ChatMessage[] = [
        { role: "assistant", content: "Response" }
      ];
      const result = langwatchSpan.setOutput("chat_messages", messages);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"chat_messages"')
      );
    });

    it("should handle explicit list type", () => {
      const list: SpanInputOutput[] = [
        { type: "text", value: "Response 1" },
        { type: "text", value: "Response 2" }
      ];
      const result = langwatchSpan.setOutput("list", list);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"list"')
      );
    });

    it("should handle explicit json type", () => {
      const data = { response: "success", data: { id: 123 } };
      const result = langwatchSpan.setOutput("json", data);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"json"')
      );
    });

    it("should handle auto-detection (single parameter)", () => {
      const result = langwatchSpan.setOutput("Response");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"text"')
      );
    });

    it("should handle auto-detection for objects", () => {
      const obj = { response: "data" };
      const result = langwatchSpan.setOutput(obj);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"json"')
      );
    });

    it("should handle auto-detection for arrays", () => {
      const arr = ["response1", "response2"];
      const result = langwatchSpan.setOutput(arr);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"list"')
      );
    });
  });

  describe("type preference behavior", () => {
    it("should prefer explicit types over auto-detection for setInput", () => {
      // Object that would auto-detect as "json", but explicit "text" should be preferred
      const obj = { key: "value" };
      (langwatchSpan.setInput as any)("text", obj);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"text"')
      );

      // String that would auto-detect as "text", but explicit "json" should be preferred
      (langwatchSpan.setOutput as any)("json", "Hello world");
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type":"json"')
      );
    });
  });

  describe("error handling", () => {
    it("should handle invalid input gracefully", () => {
      const result = (langwatchSpan.setInput as any)("invalid_type", "test");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalled();
    });

    it("should handle invalid output gracefully", () => {
      const result = (langwatchSpan.setOutput as any)("invalid_type", "test");

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalled();
    });

    it("should handle non-serializable objects", () => {
      const objWithFunction = {
        data: "test",
        method: () => "hello"
      };
      const result = langwatchSpan.setInput(objWithFunction);

      expect(result).toBe(langwatchSpan);
      expect(mockSpan.setAttribute).toHaveBeenCalled();
    });
  });
});
