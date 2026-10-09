import { describe, expect, it } from "vitest";

import type { UpgradePostgres } from "../../ports.ts";
import { upgradeGateOver } from "../serving-upgrade-gate.ts";

const MISSING = 'relation "mydb_upgrade_ledger._langwatch_upgrade_run" does not exist';

/** A database still on main: the schema answers, the ledger tables are not there. */
const databaseWithoutLedger: UpgradePostgres = {
  query: async <Row extends object>(text: string) => {
    if (text.includes('AS "schema"')) return { rows: [{ schema: "public" } as Row] };
    if (text.includes("to_regclass")) return { rows: [{ present: false } as Row] };
    throw new Error(MISSING);
  },
};

describe("the api's serving gate on a database with no upgrade ledger", () => {
  it("reports the installation as upgrading instead of refusing to start", async () => {
    const gate = upgradeGateOver({
      role: "api",
      postgres: databaseWithoutLedger,
      close: async () => undefined,
      tree: { prismaFolders: ["20261006180000_add_column"], gooseFiles: [], codeSteps: [] },
      release: "3.21.0",
      withClickHouse: false,
      processId: "api-1",
      firstInstall: async () => ({ exitCode: 0, logTail: [] }),
    });

    await expect(gate.admit()).resolves.toMatchObject({ admitted: false, outcome: "upgrading" });
  });
});
