import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const here = resolve(fileURLToPath(import.meta.url), "..");
const cliSource = resolve(here, "../src/cli.ts");
const PORT_BASE = 47_000;

async function runDoctor({ home }: { home: string }) {
  const result = await execa(
    "node",
    ["--experimental-transform-types", cliSource, "doctor", "--port-base", String(PORT_BASE)],
    { env: { ...process.env, LANGWATCH_HOME: home, NO_COLOR: "1" }, reject: false },
  );
  return { stdout: result.stdout, exitCode: result.exitCode };
}

/** The Postgres port doctor's own port table reports for this base. */
async function postgresPortFor({ home }: { home: string }): Promise<number> {
  const { stdout } = await runDoctor({ home });
  return Number(/postgres\s+(\d+)/.exec(stdout)?.[1]);
}

describe("CLI doctor upgrade block", () => {
  const closers: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function listenOn({ port }: { port: number }): Promise<void> {
    const listener = createServer();
    await new Promise<void>((ready) => listener.listen(port, "127.0.0.1", ready));
    closers.push(() => new Promise<void>((done) => listener.close(() => done())));
  }

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

  describe("when the local database accepts connections", () => {
    /** @scenario "Doctor prints the upgrade status of an installation whose database is running" */
    it("prints what the upgrade status command prints", async () => {
      const home = await mkdtemp(join(tmpdir(), "langwatch-doctor-upgrade-"));
      const port = await postgresPortFor({ home });
      await listenOn({ port });
      await mkdir(join(home, "bin"), { recursive: true });
      const fakePnpm = join(home, "bin", "pnpm");
      await writeFile(
        fakePnpm,
        '#!/bin/sh\n[ "$*" = "run task upgrade status" ] && echo "Installation: Up to date (neutral)" && exit 0\nexit 9\n',
      );
      await chmod(fakePnpm, 0o755);

      const { stdout } = await runDoctor({ home });

      expect(stdout).toContain("Upgrade");
      expect(stdout).toMatch(/^ {2}Installation: Up to date \(neutral\)$/m);
      expect(stdout).not.toContain("status unavailable");
    }, 60_000);
  });
});
