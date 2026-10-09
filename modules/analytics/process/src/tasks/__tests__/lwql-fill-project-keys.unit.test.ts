import { describe, expect, it, vi } from "vitest";

import {
  LangWatchQLProvisioningRepository,
  type LwqlKeyMapInsertRow,
} from "../../repositories/langwatch-ql-provisioning.repository.ts";
import { fillLwqlProjectKeys } from "../lwql-provision.task.ts";

/** A key map held in memory: the rows a fill wrote are the hashes the next fill reads. */
class KeyMap extends LangWatchQLProvisioningRepository {
  readonly rows: LwqlKeyMapInsertRow[] = [];
  runStatements = vi.fn();
  inventoryConfigStore = vi.fn();
  probeOwner = vi.fn();
  queryRows = vi.fn();
  close = vi.fn(async () => undefined);

  async findKeyMapHashes({ tenantId }: { table: string; tenantId: string }): Promise<string[]> {
    return this.rows.filter((row) => row.TenantId === tenantId).map((row) => row.KeyHash);
  }

  async insertKeyMapRows({ rows }: { table: string; rows: readonly LwqlKeyMapInsertRow[] }) {
    this.rows.push(...rows);
  }
}

/** Three projects over two pages, the second project without a key. */
const projectKeys = {
  listLwqlKeys: async ({ after }: { after?: string } = {}) =>
    after === undefined
      ? { projects: [{ id: "project_a", lwqlKey: "key-a" }], next: "project_a" }
      : {
          projects: [
            { id: "project_b", lwqlKey: "" },
            { id: "project_c", lwqlKey: "key-c" },
          ],
          next: null,
        },
};

function fill({ keyMap, dryRun = false }: { keyMap: KeyMap; dryRun?: boolean }) {
  return fillLwqlProjectKeys({
    openRepository: () => keyMap,
    projectKeys,
    names: {
      database: "langwatch_ql",
      restrictedUser: "lwql_reader",
      settingsProfile: "lwql_profile",
      keyMapTable: "api_key_tenant_map",
      tenantSetting: "custom_lwql_tenant",
    },
    sourceDatabase: "langwatch",
    dryRun,
  });
}

describe("fillLwqlProjectKeys", () => {
  /** @scenario "The fill step writes each missing row and reports blank keys" */
  it("writes a row per keyed project across pages and counts the blank key", async () => {
    const keyMap = new KeyMap();

    await expect(fill({ keyMap })).resolves.toEqual({ inserted: 2, blankKeys: 1 });
    expect(keyMap.rows.map((row) => row.TenantId)).toEqual(["project_a", "project_c"]);
    expect(keyMap.close).toHaveBeenCalled();
  });

  /** @scenario "A rerun of the fill step writes nothing new" */
  it("inserts nothing on a second run", async () => {
    const keyMap = new KeyMap();
    await fill({ keyMap });

    await expect(fill({ keyMap })).resolves.toEqual({ inserted: 0, blankKeys: 1 });
    expect(keyMap.rows).toHaveLength(2);
  });

  /** @scenario "A dry run of the fill step writes nothing" */
  it("reports the rows a dry run would insert and writes none", async () => {
    const keyMap = new KeyMap();

    await expect(fill({ keyMap, dryRun: true })).resolves.toEqual({ inserted: 2, blankKeys: 1 });
    expect(keyMap.rows).toHaveLength(0);
  });
});
