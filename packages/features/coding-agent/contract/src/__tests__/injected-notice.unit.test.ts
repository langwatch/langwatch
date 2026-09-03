/** @vitest-environment node */

import { describe, expect, it } from "vitest";
import { classifyPromptText } from "../injected-notice";

describe("classifyPromptText", () => {
  it("keeps human text and inline tags as the prompt", () => {
    expect(classifyPromptText("check git status and bump the version")).toEqual({
      notices: [],
      remainder: "check git status and bump the version",
    });
    expect(
      classifyPromptText(
        "the parser chokes on <task-notification>foo</task-notification> in the body",
      ).remainder,
    ).toContain("<task-notification>");
  });

  it("names and preserves an injected block, leaving no prompt", () => {
    const notification = [
      "<task-notification>",
      "  <summary>Monitor event: PR watch: CI + comments</summary>",
      "  <body>2 new comments on langwatch#4711</body>",
      "</task-notification>",
    ].join("\n");
    const result = classifyPromptText(notification);

    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.label).toBe(
      "task notification: Monitor event: PR watch: CI + comments",
    );
    expect(result.notices[0]?.body).toContain("2 new comments on langwatch#4711");
    expect(result.remainder).toBeNull();
  });

  it("splits several blocks into separate notices", () => {
    const result = classifyPromptText(
      "<system-reminder>Do not mention this reminder.</system-reminder>\n" +
        "<task-notification><summary>Build finished</summary></task-notification>",
    );

    expect(result.notices.map((notice) => notice.label)).toEqual([
      "system reminder",
      "task notification: Build finished",
    ]);
  });

  it("collapses and truncates long summaries", () => {
    const long = classifyPromptText(
      `<task-notification><summary>${"x".repeat(400)}</summary></task-notification>`,
    );
    const multiline = classifyPromptText(
      "<task-notification><summary>\n  Monitor event\n  fired twice\n</summary></task-notification>",
    );

    expect(long.notices[0]?.label.length).toBeLessThanOrEqual("task notification: ".length + 120);
    expect(long.notices[0]?.label.endsWith("…")).toBe(true);
    expect(multiline.notices[0]?.label).toBe("task notification: Monitor event fired twice");
  });

  it("handles the plain system marker and an unclosed block", () => {
    const marker = classifyPromptText(
      "[SYSTEM NOTIFICATION - NOT USER INPUT]\n<summary>Rate limit reset</summary>\nContinue.",
    );
    expect(marker.notices[0]?.label).toBe("Rate limit reset");
    expect(marker.remainder).toBeNull();

    const unclosed = classifyPromptText("<task-notification>never closed, and then some words");
    expect(unclosed.notices).toEqual([]);
    expect(unclosed.remainder).toContain("never closed");
  });

  it("keeps human text following a leading injected block", () => {
    const result = classifyPromptText(
      "<system-reminder>Background task finished.</system-reminder>\n\nnow ship it",
    );

    expect(result.notices.map((notice) => notice.label)).toEqual(["system reminder"]);
    expect(result.remainder).toBe("now ship it");
  });
});
