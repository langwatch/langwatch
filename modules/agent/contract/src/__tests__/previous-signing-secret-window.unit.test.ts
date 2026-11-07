import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { isPreviousSigningSecretOpen } from "../config/http.ts";

const NOW = Temporal.Instant.from("2026-10-30T12:00:00Z");

describe("isPreviousSigningSecretOpen", () => {
  it("is open while expiresAt is later than now", () => {
    expect(
      isPreviousSigningSecretOpen(
        { secret: "{{ secrets.S0 }}", expiresAt: "2026-10-30T12:00:01Z" },
        NOW,
      ),
    ).toBe(true);
  });

  it("is closed once expiresAt is earlier than now", () => {
    expect(
      isPreviousSigningSecretOpen(
        { secret: "{{ secrets.S0 }}", expiresAt: "2026-10-30T11:59:59Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("is closed exactly at expiresAt", () => {
    expect(
      isPreviousSigningSecretOpen(
        { secret: "{{ secrets.S0 }}", expiresAt: "2026-10-30T12:00:00Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("counts an unparseable expiry as closed", () => {
    expect(
      isPreviousSigningSecretOpen({ secret: "{{ secrets.S0 }}", expiresAt: "not a date" }, NOW),
    ).toBe(false);
  });
});
