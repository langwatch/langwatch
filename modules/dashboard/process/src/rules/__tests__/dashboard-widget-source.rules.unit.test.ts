/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { widgetSourceOfCredential } from "../dashboard-widget-source.rules.ts";

describe("widgetSourceOfCredential()", () => {
  describe("given a project API key", () => {
    /** @scenario "A widget created through the API without a source records the API" */
    it("records the API", () => {
      expect(widgetSourceOfCredential({ credential: { type: "apiKey" } })).toEqual({ kind: "api" });
      expect(widgetSourceOfCredential({ credential: { type: "legacyProjectKey" } })).toEqual({
        kind: "api",
      });
    });
  });

  describe("given Langy's session key", () => {
    /** @scenario "A widget Langy creates records Langy as its source" */
    it("records Langy", () => {
      expect(
        widgetSourceOfCredential({ credential: { type: "apiKey", isLangySessionKey: true } }),
      ).toEqual({ kind: "langy" });
    });
  });
});
