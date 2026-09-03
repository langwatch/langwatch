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

  it("caps one message at the per-message budget, marker included", () => {
    const line = renderMessageLine({ role: "user", content: "x".repeat(DIGEST_MESSAGE_MAX_BYTES * 2) });
    expect(line).toBeDefined();
    // The marker rides INSIDE the budget: a line that overshot it by the
    // marker's own length would break the cap buildHandoffDigest counts on.
    expect(Buffer.byteLength(line as string, "utf8")).toBeLessThanOrEqual(
      DIGEST_MESSAGE_MAX_BYTES,
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

    // A message whose content ARRAY holds a null is the harder case: the entry
    // itself is well formed, so it reaches the block loop. Reading .type off
    // null threw, runner.ts caught it, and the resumed worker was seeded with an
    // empty digest, losing the whole conversation without a word.
    it("skips invalid content blocks and keeps the rest of the conversation", () => {
      const digest = buildHandoffDigest({
        messages: [
          { role: "user", content: [null] },
          { role: "assistant", content: ["a string, not a block", 7] },
          { role: "user", content: [{ type: "text", text: "survives" }] },
        ],
      });
      expect(digest).toBe("user: survives");
    });
  });

  describe("when the budget is smaller than the truncation header", () => {
    // maxBytes is a hard bound. Prepending the header regardless returned more
    // bytes than the caller allowed, on the one path meant to enforce the cap.
    it("returns nothing rather than a header that breaks the bound", () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        role: "user",
        content: `message ${i}`,
      }));
      expect(buildHandoffDigest({ messages, maxBytes: 1 })).toBe("");
      expect(
        Buffer.byteLength(buildHandoffDigest({ messages, maxBytes: 4 }), "utf8"),
      ).toBeLessThanOrEqual(4);
    });
  });
});
