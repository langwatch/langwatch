// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** A refused read is told apart from a read that failed. */
import { describe, expect, it } from "vitest";

import { isReadRefused } from "../read-refusal.ts";

describe("isReadRefused", () => {
  it("answers yes for the transport's FORBIDDEN, by code or by status", () => {
    expect(isReadRefused({ data: { code: "FORBIDDEN" } })).toBe(true);
    expect(isReadRefused({ data: { httpStatus: 403 } })).toBe(true);
  });

  it("answers no for any other failure, or for no envelope at all", () => {
    expect(isReadRefused({ data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } })).toBe(false);
    expect(isReadRefused(new Error("boom"))).toBe(false);
    expect(isReadRefused(null)).toBe(false);
  });
});
