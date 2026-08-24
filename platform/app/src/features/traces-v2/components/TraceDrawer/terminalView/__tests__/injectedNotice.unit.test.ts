/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { classifyPromptText } from "../injectedNotice";

describe("classifyPromptText", () => {
  describe("given a message the human typed", () => {
    it("keeps every word of it as the prompt", () => {
      const result = classifyPromptText(
        "check git status and bump the version",
      );

      expect(result.notices).toEqual([]);
      expect(result.remainder).toBe("check git status and bump the version");
    });

    it("leaves a tag the human wrote mid-sentence alone", () => {
      const result = classifyPromptText(
        "the parser chokes on <task-notification>foo</task-notification> in the body",
      );

      expect(result.notices).toEqual([]);
      expect(result.remainder).toContain("<task-notification>");
    });
  });

  describe("given a message that is only an injected block", () => {
    const notification = [
      "<task-notification>",
      "  <summary>Monitor event: PR watch: CI + comments</summary>",
      "  <body>2 new comments on langwatch#4711</body>",
      "</task-notification>",
    ].join("\n");

    it("names it by its tag and its summary", () => {
      const result = classifyPromptText(notification);

      expect(result.notices).toHaveLength(1);
      expect(result.notices[0]?.label).toBe(
        "task notification: Monitor event: PR watch: CI + comments",
      );
    });

    it("keeps the block itself for the reader who opens it", () => {
      const result = classifyPromptText(notification);

      expect(result.notices[0]?.body).toContain(
        "2 new comments on langwatch#4711",
      );
    });

    it("leaves nothing behind as the prompt", () => {
      expect(classifyPromptText(notification).remainder).toBeNull();
    });
  });

  describe("given several blocks injected at once", () => {
    it("makes each one its own note", () => {
      const result = classifyPromptText(
        "<system-reminder>Do not mention this reminder.</system-reminder>\n" +
          "<task-notification><summary>Build finished</summary></task-notification>",
      );

      expect(result.notices.map((notice) => notice.label)).toEqual([
        "system reminder",
        "task notification: Build finished",
      ]);
    });
  });

  describe("given a summary longer than one line", () => {
    it("cuts it rather than wrapping the collapsed line", () => {
      const long = "x".repeat(400);
      const result = classifyPromptText(
        `<task-notification><summary>${long}</summary></task-notification>`,
      );

      const label = result.notices[0]?.label ?? "";
      expect(label.length).toBeLessThanOrEqual(
        "task notification: ".length + 120,
      );
      expect(label.endsWith("…")).toBe(true);
    });

    it("collapses the whitespace a multi-line summary was formatted with", () => {
      const result = classifyPromptText(
        "<task-notification><summary>\n  Monitor event\n  fired twice\n</summary></task-notification>",
      );

      expect(result.notices[0]?.label).toBe(
        "task notification: Monitor event fired twice",
      );
    });
  });

  describe("given a block with a human message under it", () => {
    it("draws the block back and keeps the human words as the prompt", () => {
      const result = classifyPromptText(
        "<system-reminder>Background task finished.</system-reminder>\n\nnow ship it",
      );

      expect(result.notices.map((notice) => notice.label)).toEqual([
        "system reminder",
      ]);
      expect(result.remainder).toBe("now ship it");
    });
  });

  describe("given the plain system notification marker", () => {
    /** @scenario "A plain system notification marker is drawn back too" */
    it("takes the whole message as one notice and leaves no prompt", () => {
      const result = classifyPromptText(
        "[SYSTEM NOTIFICATION - NOT USER INPUT] The rate limit reset.",
      );

      expect(result.notices).toHaveLength(1);
      expect(result.notices[0]?.label).toBe("system notification");
      expect(result.notices[0]?.body).toContain("The rate limit reset.");
      expect(result.remainder).toBeNull();
    });

    it("names it by the summary the marker carried, when it carried one", () => {
      const result = classifyPromptText(
        "[SYSTEM NOTIFICATION - NOT USER INPUT]\n<summary>Rate limit reset</summary>\nContinue.",
      );

      expect(result.notices[0]?.label).toBe("Rate limit reset");
    });
  });

  describe("given an unclosed block", () => {
    it("leaves the message as the prompt rather than swallowing it", () => {
      const result = classifyPromptText(
        "<task-notification>never closed, and then some words",
      );

      expect(result.notices).toEqual([]);
      expect(result.remainder).toContain("never closed");
    });
  });
});
