/** The key-map repository reads and writes the app database's key-map table by tenant. */
import { describe, expect, it, vi } from "vitest";

import type { ClickHouseAdminStatements } from "../../langwatch-ql-provisioning.repository.ts";
import { LwqlKeyMapClickHouseRepository } from "../clickhouse.langwatch-ql-key-map.repository.ts";

function repositoryOver(answer: Record<string, unknown>[]) {
  const rows = vi.fn<ClickHouseAdminStatements["rows"]>(async () => answer);
  const statements: ClickHouseAdminStatements = {
    command: () => Promise.reject(new Error("this fake answers no command")),
    rows,
    insert: () => Promise.reject(new Error("this fake answers no insert")),
  };
  return { rows, repository: LwqlKeyMapClickHouseRepository.create({ statements }) };
}

describe("finding a tenant's key hashes", () => {
  it("reads the qualified key-map table with the tenant bound as a parameter", async () => {
    const { rows, repository } = repositoryOver([{ KeyHash: "hash-a" }]);

    await repository.findKeyHashes({ tenantId: "project-1", sourceDatabase: "langwatch" });

    expect(rows).toHaveBeenCalledWith(
      "SELECT DISTINCT KeyHash FROM langwatch.lwql_api_key_tenant_map " +
        "WHERE TenantId = {tenantId:String}",
      { tenantId: "project-1" },
    );
  });

  it("returns the string hashes and drops rows without one", async () => {
    const { repository } = repositoryOver([
      { KeyHash: "hash-a" },
      { KeyHash: 42 },
      {},
      { KeyHash: "hash-b" },
    ]);

    await expect(
      repository.findKeyHashes({ tenantId: "project-1", sourceDatabase: "langwatch" }),
    ).resolves.toEqual(["hash-a", "hash-b"]);
  });
});
