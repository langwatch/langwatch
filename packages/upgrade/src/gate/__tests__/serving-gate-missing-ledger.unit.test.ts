/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-stuck-states-gate.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradePostgres } from "../../ports.ts";
import type { ServingRole } from "../serving-gate.ts";
import { upgradeGateOver } from "../serving-upgrade-gate.ts";

const MISSING = 'relation "public_upgrade_ledger._langwatch_upgrade_run" does not exist';

/** A database still on main: the schema answers, the ledger tables are not there. */
function databaseWithoutLedger({
  creatable,
  down = { now: false },
}: {
  creatable: boolean;
  down?: { now: boolean };
}): UpgradePostgres {
  return {
    query: async <Row extends object>(text: string) => {
      if (text.includes('AS "schema"')) return { rows: [{ schema: "public" } as Row] };
      if (down.now) throw new Error("Connection terminated unexpectedly");
      if (text.includes("to_regclass")) return { rows: [{ present: false } as Row] };
      if (text.includes("has_database_privilege")) return { rows: [{ creatable } as Row] };
      throw new Error(MISSING);
    },
  };
}

function gateOver({
  role,
  postgres,
  closes = [],
  runs = [],
}: {
  role: ServingRole;
  postgres: UpgradePostgres;
  closes?: string[];
  runs?: string[];
}) {
  return upgradeGateOver({
    role,
    postgres,
    close: async () => void closes.push("closed"),
    tree: { prismaFolders: ["20261006180000_add_column"], gooseFiles: [], codeSteps: [] },
    release: "3.21.0",
    withClickHouse: false,
    processId: `${role}-1`,
    firstInstall: async () => {
      runs.push("upgrade");
      return { code: "done", logTail: [] };
    },
    warn: () => undefined,
    wait: async () => undefined,
  });
}

describe("the serving gate on a database with no upgrade ledger", () => {
  describe("given a role that may create the ledger", () => {
    /** @scenario "A missing upgrade ledger the role can create is upgrading, not refused" */
    it("reports the installation as upgrading instead of refusing to start", async () => {
      const gate = gateOver({ role: "api", postgres: databaseWithoutLedger({ creatable: true }) });

      await expect(gate.admit()).resolves.toMatchObject({ admitted: false, outcome: "upgrading" });
    });
  });

  describe("given a role that can neither create the ledger schema nor a pre-created one's tables", () => {
    /** @scenario "A database role that cannot create the upgrade ledger is refused by name" */
    it.each(["api", "worker"] as const)(
      "refuses the %s by name, naming the privilege, the schema and the docs",
      async (role) => {
        const runs: string[] = [];
        const gate = gateOver({
          role,
          postgres: databaseWithoutLedger({ creatable: false }),
          runs,
        });

        const verdict = await gate.admit();

        expect(verdict).toMatchObject({ admitted: false, outcome: "ledger-not-creatable" });
        const refusal = "refusal" in verdict ? verdict.refusal : "";
        expect(refusal).toContain("CREATE on the database");
        expect(refusal).toContain('"public_upgrade_ledger"');
        expect(refusal).toContain("docs/self-hosting/upgrade.mdx");
        expect(runs).toEqual([]);
      },
    );
  });

  describe("given an api that was told the installation is upgrading", () => {
    /** @scenario "An upgrading api keeps its gate connection through a refusal or an unreadable ledger" */
    it("keeps its connection when a later ask cannot read the ledger", async () => {
      const closes: string[] = [];
      const down = { now: false };
      const gate = gateOver({
        role: "api",
        postgres: databaseWithoutLedger({ creatable: true, down }),
        closes,
      });

      await expect(gate.admit()).resolves.toMatchObject({ outcome: "upgrading" });
      down.now = true;
      await expect(gate.admit()).rejects.toThrow("Connection terminated");
      expect(closes).toEqual([]);

      await gate.release();
      expect(closes).toEqual(["closed"]);
    });
  });
});
