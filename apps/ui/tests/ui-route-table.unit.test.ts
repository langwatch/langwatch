import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { uiRoutePageKeys } from "../src/behavior/ui-page-loaders";
import {
  uiLegacyRedirectRoutes,
  uiRouteDescriptors,
  uiRouteTable,
  type UiRedirectRouteDescriptor,
  type UiRouteDescriptor,
} from "../src/model/ui-route-table";
import { expectedUiRouteTranscript } from "./fixtures/ui-route-transcript";

/** A redirect's pinned query params or segment renames, in declared order. */
function pairs(label: string, table?: Readonly<Record<string, string>>): string {
  if (!table) return "";
  const entries = Object.entries(table).map(([key, value]) => `${key}=${value}`);
  return ` [${label} ${entries.join(" ")}]`;
}

/**
 * Transcribes the table the way the fixture was transcribed from the legacy
 * `routes.tsx`: one line per route, in match order, indented by layout depth.
 * A path rename, a reordered family, a dropped redirect, a retargeted redirect
 * or a page key pointed at a different module all change a line.
 */
function transcribe(table: readonly UiRouteDescriptor[], depth = 0): string[] {
  return table.flatMap((descriptor) => {
    const indent = "  ".repeat(depth);
    if ("redirect" in descriptor) {
      const { from, to, pinParams, mapSegment } = descriptor.redirect;
      return [
        `${indent}redirect ${descriptor.path} -> ${to} (from ${from})` +
          `${pairs("pin", pinParams)}${pairs("map", mapSegment)}`,
      ];
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

/** Stand-in for a dynamic segment, so a destination becomes a real address. */
const SAMPLE_SEGMENT = "sample";

/** The pattern the router falls back to when nothing else claims a path. */
const CATCH_ALL = "*";

/** Every path the table declares, flat, which is how the router ranks them. */
function declaredPaths(): string[] {
  return uiRouteDescriptors(uiRouteTable)
    .map((descriptor) => descriptor.path)
    .filter((path): path is string => path !== void 0);
}

function redirectDescriptors(): UiRedirectRouteDescriptor[] {
  return uiRouteDescriptors(uiRouteTable).filter(
    (descriptor): descriptor is UiRedirectRouteDescriptor => "redirect" in descriptor,
  );
}

/**
 * Every concrete address a redirect can put a reader on. A segment map means
 * one row has as many destinations as it has renames, plus the bare
 * destination it falls back to.
 */
function destinationsOf(descriptor: UiRedirectRouteDescriptor): string[] {
  const { to, mapSegment } = descriptor.redirect;
  const bare = to.replace(/:[^/]+/g, SAMPLE_SEGMENT);
  if (!mapSegment) return [bare];
  return [bare, ...Object.values(mapSegment).map((segment) => `${bare}/${segment}`)];
}

/** The pattern that would win for `pathname`, or null if nothing matched. */
function resolvedPattern(pathname: string): string | null {
  const matches = matchRoutes(
    declaredPaths().map((path) => ({ path })),
    pathname,
  );
  return matches?.[0]?.route.path ?? null;
}

describe("given every redirect the table mounts", () => {
  const redirects = redirectDescriptors();

  // Both halves are read off the same table, so a filter that stops matching
  // would otherwise leave a suite that passes by checking nothing.
  it("finds the redirects and the paths they are ranked against", () => {
    expect(redirects.length).toBeGreaterThanOrEqual(20);
    expect(declaredPaths()).toContain(CATCH_ALL);
  });

  const destinations = redirects.flatMap((descriptor) =>
    destinationsOf(descriptor).map((destination) => ({
      from: descriptor.path,
      destination,
    })),
  );

  describe("when a destination is resolved the way the router would", () => {
    it.each(destinations)(
      "$from lands on $destination, which the table serves",
      ({ destination }) => {
        // The table ends in a catch-all, so every address on earth matches
        // something. Landing on it is exactly what a dangling destination
        // looks like: the reader is forwarded onto the 404 page.
        expect(resolvedPattern(destination)).not.toBe(CATCH_ALL);
      },
    );

    it.each(destinations)("$from does not forward to itself", ({ from, destination }) => {
      expect(resolvedPattern(destination)).not.toBe(from);
    });
  });
});
