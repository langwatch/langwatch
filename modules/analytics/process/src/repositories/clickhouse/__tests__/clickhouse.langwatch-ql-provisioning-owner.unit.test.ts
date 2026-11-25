/** Who owns the access model: the config store wins, then an app-owned SQL user, else none. */
import { describe, expect, it } from "vitest";

import { classifyLwqlAccessModelOwner } from "../../../rules/langwatch-ql-config-store.rules.ts";
import type { LangWatchQLNames } from "../../../services/langwatch-ql-access-model.service.ts";
import type { ClickHouseAdminStatements } from "../../langwatch-ql-provisioning.repository.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../clickhouse.langwatch-ql-provisioning.repository.ts";

/** The vendor calls these fakes answer, adapted to the repository's admin statements. */
interface FakeClickHouse {
  command?(input: { query: string }): Promise<unknown>;
  query?(input: {
    query: string;
    format?: string;
    query_params?: Record<string, unknown>;
  }): Promise<{ json(): Promise<unknown> }>;
}

const statementsOver = (client: FakeClickHouse): ClickHouseAdminStatements => ({
  async command(statement) {
    if (!client.command) throw new Error("this fake answers no command");
    await client.command({ query: statement });
  },
  async rows(sql, params) {
    if (!client.query) throw new Error("this fake answers no query");
    const result = await client.query({
      query: sql,
      format: "JSONEachRow",
      ...(params ? { query_params: { ...params } } : {}),
    });
    const rows = await result.json();
    return Array.isArray(rows) ? rows : [];
  },
  insert: () => Promise.reject(new Error("this fake answers no insert")),
});

const provisioning = (client: FakeClickHouse) =>
  ClickHouseLangWatchQLProvisioningRepository.create({ statements: statementsOver(client) });

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
 */
function fakeClient({
  n,
  calls,
  reject = false,
}: {
  n: number;
  calls: QueryCall[];
  reject?: boolean;
}): FakeClickHouse {
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
  };
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

    await expect(provisioning(client).probeOwner({ names: NAMES })).rejects.toThrow(/unreachable/);
  });

  /** @scenario "The ownership probe classifies who owns the LangWatchQL access model" */
  it("reports the SQL store owns the model and counts users by the restricted name excluding users_xml", async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient({ n: 1, calls });

    await expect(provisioning(client).probeOwner({ names: NAMES })).resolves.toBe("sql_store");

    const countCall = calls.find((c) => c.query.includes("count()"));
    expect(countCall).toBeDefined();
    expect(countCall?.query).toContain("storage != 'users_xml'");
    expect(countCall?.query_params?.user).toBe(NAMES.restrictedUser);
  });
});
