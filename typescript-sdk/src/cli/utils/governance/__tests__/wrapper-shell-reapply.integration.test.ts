/**
 * Real-shell execution test for the Path-B `unset -f` neutralization in
 * `buildShellReapply()`. String assertions in the unit suite prove the
 * prefix TEXT; this proves the RUNTIME effect the way `runWrapped` uses it —
 * spawns `$SHELL -i -c`, sources a persisted `tool() { … }` scoped function,
 * applies the reapply prefix, and observes that the REAL binary (not the
 * shadowing function) runs and inherits the reapplied env.
 *
 * A quoting / ordering / `-i -c`-sourcing regression on a shipped tool
 * (gemini/opencode/copilot) would pass every string assertion but fail here.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildShellReapply } from "../wrapper";

function has(shell: string): boolean {
  try {
    execFileSync("command", ["-v", shell], { shell: "/bin/bash", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SHELLS = ["bash", "zsh"].filter(has);
const TOOLS = ["copilot", "gemini", "opencode"] as const;
const combos = SHELLS.flatMap((shell) => TOOLS.map((tool) => ({ shell, tool })));

describe("buildShellReapply real-shell execution", () => {
  let tmp: string;
  let binDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-reapply-"));
    binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir);
    origHome = process.env.HOME;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeRealBinary(tool: string) {
    const bin = path.join(binDir, tool);
    // Proves IT ran (not the function) AND that the reapplied env reached it.
    fs.writeFileSync(
      bin,
      `#!/bin/sh\necho REAL_BINARY_RAN OTEL=$OTEL_EXPORTER_OTLP_ENDPOINT\n`,
      { mode: 0o755 },
    );
  }

  function writeShadowFunction(shell: string, tool: string) {
    const rc = shell === "zsh" ? ".zshrc" : ".bashrc";
    // A persisted Path-B scoped function that WOULD shadow the binary if the
    // reapply prefix failed to `unset -f` it.
    fs.writeFileSync(path.join(tmp, rc), `${tool}() { echo FROM_FUNCTION; }\n`);
  }

  function runInShell(shell: string, script: string): string {
    return execFileSync(shell, ["-i", "-c", script], {
      env: {
        ...process.env,
        HOME: tmp,
        ZDOTDIR: tmp, // zsh sources $ZDOTDIR/.zshrc
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
      // interactive shells without a tty warn to stderr ("cannot set
      // terminal process group") — ignore it, we assert on stdout.
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  if (combos.length === 0) {
    it("skips: no POSIX shell on PATH", () => {
      expect(true).toBe(true);
    });
  }

  it.each(combos)(
    "unset -f drops the persisted $tool function under $shell so the real binary runs with the reapplied env",
    ({ shell, tool }) => {
      writeRealBinary(tool);
      writeShadowFunction(shell, tool);

      // control: without the reapply the function shadows the binary — proves
      // the assertion below is falsifiable, not a no-op.
      const control = runInShell(shell, tool);
      expect(control).toContain("FROM_FUNCTION");

      const reapply = buildShellReapply({
        tool,
        mode: "ingestion",
        clears: [],
        vars: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://lw.example/api/otel" },
      });
      const out = runInShell(shell, `${reapply}; ${tool}`);

      // the real binary ran (function neutralized) and saw the reapplied env
      expect(out).toContain("REAL_BINARY_RAN");
      expect(out).toContain("OTEL=http://lw.example/api/otel");
      expect(out).not.toContain("FROM_FUNCTION");
    },
  );
});
