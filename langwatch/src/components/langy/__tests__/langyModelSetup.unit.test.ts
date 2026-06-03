import { describe, expect, it } from "vitest";
import { computeLangyModelSetup } from "../langyModelSetup";

describe("computeLangyModelSetup", () => {
  it("branch A: Anthropic enabled takes priority even with other providers", () => {
    const result = computeLangyModelSetup({
      anthropic: { enabled: true },
      openai: { enabled: true },
    });
    expect(result.branch).toBe("anthropic");
    expect(result.primaryProviderKey).toBe("anthropic");
    expect(result.showAnthropicNudge).toBe(false);
  });

  it("branch B: only a non-Anthropic provider enabled → use it + nudge", () => {
    const result = computeLangyModelSetup({
      openai: { enabled: true },
      anthropic: { enabled: false },
    });
    expect(result.branch).toBe("other");
    expect(result.primaryProviderKey).toBe("openai");
    expect(result.showAnthropicNudge).toBe(true);
  });

  it("branch B: picks a deterministic (sorted) primary among several others", () => {
    const result = computeLangyModelSetup({
      openai: { enabled: true },
      azure: { enabled: true },
    });
    expect(result.branch).toBe("other");
    // sorted: ["azure", "openai"] → azure is primary
    expect(result.primaryProviderKey).toBe("azure");
    expect(result.enabledProviderKeys).toEqual(["azure", "openai"]);
  });

  it("branch C: nothing enabled", () => {
    const result = computeLangyModelSetup({
      openai: { enabled: false },
      anthropic: { enabled: false },
    });
    expect(result.branch).toBe("none");
    expect(result.primaryProviderKey).toBeNull();
    expect(result.showAnthropicNudge).toBe(false);
  });

  it("branch C: empty / nullish provider maps are safe", () => {
    expect(computeLangyModelSetup({}).branch).toBe("none");
    expect(computeLangyModelSetup(undefined).branch).toBe("none");
    expect(computeLangyModelSetup(null).branch).toBe("none");
  });

  it("ignores disabled providers when listing enabled keys", () => {
    const result = computeLangyModelSetup({
      anthropic: { enabled: true },
      openai: { enabled: false },
      gemini: { enabled: true },
    });
    expect(result.enabledProviderKeys).toEqual(["anthropic", "gemini"]);
  });
});
