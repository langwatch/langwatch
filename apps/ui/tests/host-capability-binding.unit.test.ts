/**
 * The capability objects a host receives are class instances whose methods
 * read `this`; a bare `setQuery: route.setQuery` hand-off loses the receiver
 * and throws on first use. Spec: specs/ui/host-capability-binding.feature
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const featuresRoot = path.resolve(import.meta.dirname, "../src/features");
const UNBOUND_HANDOFF = /^\s+[A-Za-z]+:\s*(route|feedback|navigation|session|clipboard)\.[A-Za-z]+,?\s*$/;

function hostFiles(): string[] {
  return readdirSync(featuresRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((feature) => {
      const sections = path.join(featuresRoot, feature.name, "ui/sections");
      try {
        return readdirSync(sections)
          .filter((file) => file.endsWith("-host.tsx") || file === "host.tsx")
          .map((file) => path.join(sections, file));
      } catch {
        return [];
      }
    });
}

describe("host adapters and their capability hand-offs", () => {
  describe("when every host adapter is read", () => {
    /** @scenario "No host hands a capability method on unbound" */
    it("passes no route, feedback, navigation, session or clipboard method as a bare property", () => {
      const files = hostFiles();
      expect(files.length).toBeGreaterThan(10);
      const offenders = files.flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => UNBOUND_HANDOFF.test(line))
          .map(({ index }) => `${path.relative(featuresRoot, file)}:${index + 1}`),
      );
      expect(offenders).toEqual([]);
    });
  });
});
