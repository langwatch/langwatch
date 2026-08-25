import { describe, expect, it } from "vitest";
import { normalizeErrorMessage } from "../src";

describe("normalizeErrorMessage", () => {
  it("keeps an error cluster stable across volatile identifiers", () => {
    expect(
      normalizeErrorMessage(
        " request 550e8400-e29b-41d4-a716-446655440000 from 192.168.1.2:443 failed  ",
      ),
    ).toBe("request <UUID> from <IP>:<PORT> failed");
  });
});
