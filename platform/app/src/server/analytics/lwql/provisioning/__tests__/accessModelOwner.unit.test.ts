/**
 * The ownership probe is the sole gate on a destructive re-provision, so its
 * decision is split from its I/O and both halves are exercised here without a
 * real ClickHouse: a pure classifier over two counts, and a probe that reads
 * those counts against an injected fake client.
 *
 * @see ../accessModelOwner.ts
 * @see ../clickhouseStatementRunner.ts — inventoryConfigStoreLwqlEntities
 * @see specs/lwql/api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../accessModel";
import {
  classifyLwqlAccessModelOwner,
  probeLwqlAccessModelOwner,
} from "../accessModelOwner";

const NAMES: LangWatchQLNames = {
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
} as LangWatchQLNames;

interface QueryCall {
  query: string;
  query_params?: Record<string, unknown>;
}

/**
 * A client that dispatches on the SQL text: `SELECT 1` proves connectivity, the
 * inventory UNION-ALL that `inventoryConfigStoreLwqlEntities` issues answers
 * empty (no config-store entity), and the `system.users` count answers `n`.
 * Every call is recorded so a test can assert the count query's shape. `reject`
 * makes a `SELECT 1` fail, standing in for an unreachable server.
 */
function fakeClient({
  n,
  calls,
  reject = false,
}: {
  n: number;
  calls: QueryCall[];
  reject?: boolean;
}): ClickHouseClient {
  return {
    async query({
      query,
      query_params,
    }: {
      query: string;
      query_params?: Record<string, unknown>;
    }) {
      calls.push({ query, query_params });
      if (query.includes("SELECT 1")) {
        if (reject) throw new Error("ClickHouse is unreachable");
        return { text: async () => "1", json: async () => [{ 1: 1 }] };
      }
      if (query.includes("count()")) {
        return { json: async () => [{ n }] };
      }
      // The inventory UNION-ALL: no config-store entity is rendered.
      return { json: async () => [] };
    },
  } as unknown as ClickHouseClient;
}

describe("classifyLwqlAccessModelOwner", () => {
  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("reports the config store owns the model when it renders any entity, even alongside a SQL-store user", () => {
    expect(
      classifyLwqlAccessModelOwner({
        configStoreEntityCount: 3,
        sqlStoreUserCount: 1,
      }),
    ).toBe("config_store");
  });

  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("reports the SQL store owns the model when only the app-owned user is present", () => {
    expect(
      classifyLwqlAccessModelOwner({
        configStoreEntityCount: 0,
        sqlStoreUserCount: 1,
      }),
    ).toBe("sql_store");
  });

  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("reports neither owns the model when both counts are zero", () => {
    expect(
      classifyLwqlAccessModelOwner({
        configStoreEntityCount: 0,
        sqlStoreUserCount: 0,
      }),
    ).toBe("none");
  });
});

describe("probeLwqlAccessModelOwner", () => {
  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("throws when the connectivity check cannot reach ClickHouse rather than reporting none", async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient({ n: 0, calls, reject: true });

    await expect(
      probeLwqlAccessModelOwner({ client, names: NAMES }),
    ).rejects.toThrow(/unreachable/);
  });

  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("reports the SQL store owns the model and counts users by the restricted name excluding users_xml", async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient({ n: 1, calls });

    await expect(
      probeLwqlAccessModelOwner({ client, names: NAMES }),
    ).resolves.toBe("sql_store");

    const countCall = calls.find((c) => c.query.includes("count()"));
    expect(countCall).toBeDefined();
    expect(countCall?.query).toContain("storage != 'users_xml'");
    expect(countCall?.query_params?.user).toBe(NAMES.restrictedUser);
  });
});
