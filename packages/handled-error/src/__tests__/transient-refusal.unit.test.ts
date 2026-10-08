import { describe, expect, it } from "vitest";

import { HandledError, TRANSIENT_REFUSAL_CODES, isTransientRefusal } from "../handled-error.ts";

class Refusal extends HandledError {
  constructor({ code, httpStatus }: { code: string; httpStatus: number }) {
    super(code, "Try again shortly", { httpStatus, fault: "platform" });
    this.name = "Refusal";
  }
}

describe("isTransientRefusal", () => {
  /** @scenario "The transient allowlist is declared once" */
  it("names exactly the two transient refusal codes", () => {
    expect(TRANSIENT_REFUSAL_CODES).toHaveLength(2);
    expect(new Set(TRANSIENT_REFUSAL_CODES)).toEqual(
      new Set(["clickhouse_overloaded", "service_unavailable"]),
    );
  });

  /** @scenario "The transient allowlist is declared once" */
  it.each(TRANSIENT_REFUSAL_CODES)("answers yes for %s at 503", (code) => {
    expect(isTransientRefusal(new Refusal({ code, httpStatus: 503 }))).toBe(true);
  });

  /** @scenario "The transient allowlist is declared once" */
  it("answers no for a transient code at any other status", () => {
    expect(isTransientRefusal(new Refusal({ code: "service_unavailable", httpStatus: 500 }))).toBe(
      false,
    );
  });

  /** @scenario "The transient allowlist is declared once" */
  it("answers no for any other code at 503", () => {
    expect(isTransientRefusal(new Refusal({ code: "pool_drained", httpStatus: 503 }))).toBe(false);
  });
});
