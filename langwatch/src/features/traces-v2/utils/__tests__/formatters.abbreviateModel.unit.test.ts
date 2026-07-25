import { describe, expect, it } from "vitest";
import { abbreviateModel } from "../formatters";

describe("abbreviateModel", () => {
  it("shows model ids as-is, no shortening magic", () => {
    expect(abbreviateModel("gpt-5-mini")).toBe("gpt-5-mini");
    expect(abbreviateModel("openai/gpt-4o-mini")).toBe("openai/gpt-4o-mini");
    expect(abbreviateModel("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001",
    );
    expect(abbreviateModel("elevenlabs/eleven_flash_v2")).toBe(
      "elevenlabs/eleven_flash_v2",
    );
  });

  it("strips Anthropic's context-window-variant suffix (wire metadata, not identity)", () => {
    expect(abbreviateModel("claude-opus-4-8[1m]")).toBe("claude-opus-4-8");
    expect(abbreviateModel("anthropic/claude-opus-4-8[1m]")).toBe(
      "anthropic/claude-opus-4-8",
    );
  });
});
