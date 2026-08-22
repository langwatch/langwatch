import { describe, expect, it } from "vitest";
import {
  DIGEST_MAX_BYTES,
  DIGEST_MESSAGE_MAX_BYTES,
  DIGEST_TRUNCATION_HEADER,
  buildHandoffDigest,
  renderMessageLine,
} from "./digest.js";

describe("renderMessageLine", () => {
  it("renders string content with the role label", () => {
    expect(renderMessageLine({ role: "user", content: "hello" })).toBe("user: hello");
  });

  it("renders assistant block content, keeping text and tool calls, dropping thinking", () => {
    const line = renderMessageLine({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret plan" },
        { type: "text", text: "the answer" },
        { type: "toolCall", name: "bash", arguments: { command: "ls" } },
      ],
    });
    expect(line).toContain("the answer");
    expect(line).toContain('[tool call: bash {"command":"ls"}]');
    expect(line).not.toContain("secret plan");
  });

  it("labels tool results with the tool name and error flag", () => {
    expect(
      renderMessageLine({ role: "toolResult", toolName: "bash", isError: true, content: "boom" }),
    ).toBe("toolResult(bash, error): boom");
  });

  it("skips empty and bashExecution messages", () => {
    expect(renderMessageLine({ role: "user", content: "" })).toBeUndefined();
    expect(renderMessageLine({ role: "bashExecution", content: "x" })).toBeUndefined();
  });

  it("caps one message at the per-message budget", () => {
    const line = renderMessageLine({ role: "user", content: "x".repeat(DIGEST_MESSAGE_MAX_BYTES * 2) });
    expect(line).toBeDefined();
    expect(Buffer.byteLength(line as string, "utf8")).toBeLessThanOrEqual(
      DIGEST_MESSAGE_MAX_BYTES + "\n[message truncated]".length,
    );
    expect(line).toContain("[message truncated]");
  });
});

describe("buildHandoffDigest", () => {
  describe("when a conversation that fits", () => {
    it("keeps every message in original order with no truncation header", () => {
      const digest = buildHandoffDigest({
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: [{ type: "text", text: "second" }] },
        ],
      });
      expect(digest).toBe("user: first\nassistant: second");
    });
  });

  describe("when a conversation over the budget", () => {
    it("keeps the newest messages, drops the oldest, and marks the drop", () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        role: "user",
        content: `message ${i} ${"x".repeat(4000)}`,
      }));
      const digest = buildHandoffDigest({ messages, maxBytes: 16 * 1024 });
      expect(Buffer.byteLength(digest, "utf8")).toBeLessThanOrEqual(16 * 1024);
      expect(digest.startsWith(DIGEST_TRUNCATION_HEADER)).toBe(true);
      expect(digest).toContain("message 49");
      expect(digest).not.toContain("message 0 ");
      // Order among kept messages is oldest-first.
      expect(digest.indexOf("message 48")).toBeLessThan(digest.indexOf("message 49"));
    });

    it("never exceeds the default 64KB bound", () => {
      const messages = Array.from({ length: 200 }, (_, i) => ({
        role: "user",
        content: `m${i} ${"y".repeat(2000)}`,
      }));
      const digest = buildHandoffDigest({ messages });
      expect(Buffer.byteLength(digest, "utf8")).toBeLessThanOrEqual(DIGEST_MAX_BYTES);
    });
  });

  describe("when garbage entries", () => {
    it("skips them instead of throwing", () => {
      expect(buildHandoffDigest({ messages: [null, 42, {}, { role: "user", content: "ok" }] })).toBe("user: ok");
    });
  });
});
