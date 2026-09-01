import { describe, expect, it } from "vitest";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import {
  uiLegacyRedirectRoutes,
  uiRouteTable,
  type UiRouteDescriptor,
} from "../src/model/ui-route-table";
import { expectedUiRouteTranscript } from "./fixtures/ui-route-transcript";

/**
 * Transcribes the table the way the fixture was transcribed from the legacy
 * `routes.tsx`: one line per route, in match order, indented by layout depth.
 * A path rename, a reordered family, a dropped redirect or a page key pointed
 * at a different module all change a line.
 */
function transcribe(table: readonly UiRouteDescriptor[], depth = 0): string[] {
  return table.flatMap((descriptor) => {
    const indent = "  ".repeat(depth);
    if ("redirect" in descriptor) {
      const { from, to, pinParams } = descriptor.redirect;
      const pins = pinParams
        ? ` [pin ${Object.entries(pinParams)
            .map(([key, value]) => `${key}=${value}`)
            .join(" ")}]`
        : "";
      return [`${indent}redirect ${descriptor.path} -> ${to} (from ${from})${pins}`];
    }
    const line =
      descriptor.path === void 0
        ? `${indent}layout -> ${descriptor.page}`
        : `${indent}route ${descriptor.path} -> ${descriptor.page}`;
    return [line, ...transcribe(descriptor.children ?? [], depth + 1)];
  });
}

describe("given the packaged route table", () => {
  describe("when its URL surface is transcribed", () => {
    it("matches the expectation derived from the legacy route table", () => {
      expect(transcribe(uiRouteTable)).toEqual([...expectedUiRouteTranscript]);
    });
  });

  describe("when a page key is read twice", () => {
    it("lists each page key once, in table order", () => {
      const keys = uiRoutePageKeys(uiRouteTable);

      expect(new Set(keys).size).toBe(keys.length);
      expect(keys[0]).toBe("pages/auth/signin");
      expect(keys).toContain("features/langy/ProjectLangyLayout");
      expect(keys).toContain("pages/not-found");
    });

    it("names no redirect, because a redirect loads no page", () => {
      expect(uiRoutePageKeys(uiLegacyRedirectRoutes)).toEqual([]);
    });
  });

  describe("when the retired prefixes are read", () => {
    it("keeps every legacy redirect in the table it is spread into", () => {
      const transcript = transcribe(uiRouteTable);

      for (const redirect of uiLegacyRedirectRoutes) {
        expect(transcript.some((line) => line.includes(`redirect ${redirect.path} ->`))).toBe(true);
      }
    });
  });
});
