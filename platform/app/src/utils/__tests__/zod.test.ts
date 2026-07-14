import { describe, expect, it } from "vitest";
import { mapZodIssuesToLogContext } from "../zod";

describe("mapZodIssuesToLogContext", () => {
  it("joins nested path segments with dots", () => {
    const result = mapZodIssuesToLogContext([
      { path: ["a", "b", 0], code: "invalid_type", message: "Expected string" },
    ]);

    expect(result).toEqual([
      { path: "a.b.0", code: "invalid_type", message: "Expected string" },
    ]);
  });

  it("returns empty string for empty path", () => {
    const result = mapZodIssuesToLogContext([
      { path: [], code: "custom", message: "Top-level error" },
    ]);

    expect(result).toEqual([
      { path: "", code: "custom", message: "Top-level error" },
    ]);
  });

  it("preserves code and message fields", () => {
    const result = mapZodIssuesToLogContext([
      { path: ["field"], code: "too_small", message: "Must be at least 1" },
    ]);

    expect(result[0]!.code).toBe("too_small");
    expect(result[0]!.message).toBe("Must be at least 1");
  });

  it("handles empty issues array", () => {
    expect(mapZodIssuesToLogContext([])).toEqual([]);
  });

  it("handles multiple issues", () => {
    const result = mapZodIssuesToLogContext([
      { path: ["name"], code: "invalid_type", message: "Required" },
      { path: ["settings", "model"], code: "invalid_type", message: "Required" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]!.path).toBe("name");
    expect(result[1]!.path).toBe("settings.model");
  });
});
