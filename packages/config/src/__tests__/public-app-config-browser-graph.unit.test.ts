import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** Browser-safe contract must not reach deployment projection (secret variable names leak
 * at module scope); match import/export STATEMENTS, not bare path */
const MODULE_EDGE =
  /^\s*(?:import|export)\b[^;]*?["'][^"']*public-(?:app-)?config\.projection["']/m;
const here = dirname(fileURLToPath(import.meta.url));
const readSource = (relative: string) => readFileSync(resolve(here, "..", relative), "utf8");

/**
 * The browser's reader, in ui-kernel. Read across the workspace on purpose:
 * the edge spans two packages and a guard must check both of them.
 */
const readApplicationReader = () =>
  readFileSync(resolve(here, "..", "..", "..", "ui-kernel", "src", "public-config.ts"), "utf8");

describe("given the browser's public-config reader", () => {
  describe("when it is imported by client code", () => {
    it("reaches no module that declares the deployment's secrets", () => {
      expect(readSource("public-app-config.ts")).not.toMatch(MODULE_EDGE);
      expect(readApplicationReader()).not.toMatch(MODULE_EDGE);
    });

    it("keeps the projection reachable on its own subpath", () => {
      const source = readSource("public-app-config.projection.ts");
      expect(source).toContain("SENDGRID_API_KEY");
    });
  });
});
