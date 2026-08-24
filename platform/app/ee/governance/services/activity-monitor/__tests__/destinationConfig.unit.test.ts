import { describe, expect, it } from "vitest";
import {
  destinationConfigSchema,
  safeParseDestinationConfig,
} from "../destinationConfig.schema";

describe("email destination config", () => {
  it("canonicalizes recipient case and whitespace", () => {
    expect(
      destinationConfigSchema.parse({
        destinations: [{ type: "email", to: [" Admin@Example.COM "] }],
      }),
    ).toEqual({
      destinations: [{ type: "email", to: ["admin@example.com"] }],
    });
  });

  it("allows only one email destination including case variants", () => {
    const result = destinationConfigSchema.safeParse({
      destinations: [
        { type: "email", to: ["admin@example.com"] },
        { type: "email", to: ["ADMIN@EXAMPLE.COM"] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("limits the total synchronous email fanout to ten", () => {
    const result = destinationConfigSchema.safeParse({
      destinations: [
        {
          type: "email",
          to: Array.from(
            { length: 11 },
            (_, index) => `member${index}@example.com`,
          ),
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects persisted destination values that are not arrays", () => {
    expect(
      safeParseDestinationConfig({ destinations: { type: "email" } }).ok,
    ).toBe(false);
  });
});
