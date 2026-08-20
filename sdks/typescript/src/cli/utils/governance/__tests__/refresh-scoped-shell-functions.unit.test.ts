/**
 * refreshScopedShellFunctions — re-syncs the gemini/opencode scoped shell
 * wrapper functions to the current run's endpoint + key (latest login
 * wins, #6202). A marker pair is explicit langwatch authorship, so any
 * present block whose body doesn't carry the current values is rewritten
 * in place across every rc file that has one.
 */
import * as fs from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { buildOtelEnvBlock } from "../otel-env-block";
import {
  buildScopedToolFunction,
  persistBlockToRc,
  rcPath,
  toolMarkers,
} from "../shell-rc";
import { refreshScopedShellFunctions } from "../telemetry-refresh";
import {
  CURRENT_ENDPOINT,
  CURRENT_TOKEN,
  installTempHomeAndCwd,
  STALE_ENDPOINT,
  STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

installTempHomeAndCwd();

describe("refreshScopedShellFunctions", () => {
  const staleGeminiVars = buildOtelEnvBlock(
    "gemini",
    STALE_ENDPOINT,
    STALE_TOKEN,
  );
  const currentGeminiVars = buildOtelEnvBlock(
    "gemini",
    CURRENT_ENDPOINT,
    CURRENT_TOKEN,
  );

  describe("given a stale gemini function in ~/.zshrc and ~/.bashrc", () => {
    beforeEach(() => {
      for (const shell of ["zsh", "bash"] as const) {
        persistBlockToRc(
          shell,
          buildScopedToolFunction("gemini", staleGeminiVars, shell),
          toolMarkers("gemini"),
        );
      }
    });

    describe("when refreshed with the current run's values", () => {
      it("rewrites the marker block in every rc that carries one", () => {
        const labels = refreshScopedShellFunctions({
          tool: "gemini",
          vars: currentGeminiVars,
        });

        expect(labels).toHaveLength(2);
        for (const shell of ["zsh", "bash"] as const) {
          const rc = fs.readFileSync(rcPath(shell), "utf8");
          expect(rc).toContain(CURRENT_ENDPOINT);
          expect(rc).not.toContain(STALE_ENDPOINT);
          expect(rc).not.toContain(STALE_TOKEN);
        }
      });

      it("preserves user-authored rc lines outside the markers", () => {
        const zshrc = rcPath("zsh");
        fs.writeFileSync(
          zshrc,
          `alias ll='ls -la'\n${fs.readFileSync(zshrc, "utf8")}export MY_VAR=1\n`,
        );

        refreshScopedShellFunctions({
          tool: "gemini",
          vars: currentGeminiVars,
        });

        const rc = fs.readFileSync(zshrc, "utf8");
        expect(rc).toContain("alias ll='ls -la'");
        expect(rc).toContain("export MY_VAR=1");
        expect(
          (rc.match(/# >>> langwatch gemini begin >>>/g) ?? []).length,
        ).toBe(1);
      });
    });
  });

  describe("given the function already carries the current values", () => {
    it("touches nothing and reports no labels", () => {
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction("gemini", currentGeminiVars, "zsh"),
        toolMarkers("gemini"),
      );
      const before = fs.readFileSync(rcPath("zsh"), "utf8");

      const labels = refreshScopedShellFunctions({
        tool: "gemini",
        vars: currentGeminiVars,
      });

      expect(labels).toEqual([]);
      expect(fs.readFileSync(rcPath("zsh"), "utf8")).toBe(before);
    });
  });

  describe("given no rc carries the tool's marker block", () => {
    it("writes nothing", () => {
      const labels = refreshScopedShellFunctions({
        tool: "opencode",
        vars: buildOtelEnvBlock("opencode", CURRENT_ENDPOINT, CURRENT_TOKEN),
      });
      expect(labels).toEqual([]);
      expect(fs.existsSync(rcPath("zsh"))).toBe(false);
    });
  });
});
