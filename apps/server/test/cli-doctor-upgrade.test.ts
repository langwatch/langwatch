import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

const here = resolve(fileURLToPath(import.meta.url), "..");
const cliSource = resolve(here, "../src/cli.ts");
const PORT_BASE = 47_000;

async function runDoctor({ home }: { home: string }) {
  const result = await execa(
    "node",
    ["--experimental-transform-types", cliSource, "doctor", "--port-base", String(PORT_BASE)],
    {
      env: { ...process.env, LANGWATCH_HOME: home, NO_COLOR: "1", FORCE_COLOR: undefined },
      reject: false,
    },
  );
  return { stdout: result.stdout, exitCode: result.exitCode };
}

describe("CLI doctor upgrade block", () => {
  describe("when the local database does not accept connections", () => {
    /** @scenario "Doctor says the upgrade status is unavailable when the database is not running" */
    it("says the status is unavailable and still prints the predeps and ports", async () => {
      const home = await mkdtemp(join(tmpdir(), "langwatch-doctor-upgrade-"));

      const { stdout } = await runDoctor({ home });

      expect(stdout).toContain("Upgrade");
      expect(stdout).toMatch(/status unavailable: the database is not running/);
      expect(stdout).toContain("Predeps");
      expect(stdout).toContain(`Ports (port-base=${PORT_BASE})`);
    }, 60_000);
  });
});
