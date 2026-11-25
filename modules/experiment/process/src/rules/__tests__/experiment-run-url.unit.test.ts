/**
 * @vitest-environment node
 * Which origin a run link is built on: BASE_HOST, else the deprecated NEXT_PUBLIC_BASE_URL.
 */
import { describe, expect, it } from "vitest";

import { runLinkBaseOf } from "../experiment-run-url.rules.ts";

describe("runLinkBaseOf", () => {
  /** @scenario "A run link reads BASE_HOST before NEXT_PUBLIC_BASE_URL" */
  it("prefers BASE_HOST and flags nothing", () => {
    expect(
      runLinkBaseOf({
        publicBaseUrl: "https://base.test",
        legacyPublicBaseUrl: "https://old.test",
      }),
    ).toEqual({ baseUrl: "https://base.test", deprecated: false });
  });

  it("falls back to NEXT_PUBLIC_BASE_URL and flags it deprecated", () => {
    expect(
      runLinkBaseOf({ publicBaseUrl: undefined, legacyPublicBaseUrl: "https://old.test" }),
    ).toEqual({ baseUrl: "https://old.test", deprecated: true });
  });

  /** @scenario "A run link has no origin when neither address is set" */
  it("has no origin when neither is set", () => {
    expect(runLinkBaseOf({ publicBaseUrl: undefined, legacyPublicBaseUrl: undefined })).toEqual({
      baseUrl: undefined,
      deprecated: false,
    });
  });
});
