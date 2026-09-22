import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import type {
  BetterAuthHooksRepository,
  FederatedAccountRow,
} from "../../repositories/better-auth-hooks.repository.ts";
import {
  LegacySsoAccessService,
  type LegacySsoAccessConnections,
  type LegacySsoAccessMemberships,
} from "../legacy-sso-access.service.ts";

const ORG = "org_acme";
const LEGACY = "ssoc_legacy";

const ROWS: FederatedAccountRow[] = [
  { rowId: "acc_1", userId: "user_1", providerId: "auth0", accountId: "waad|acme|dana" },
  { rowId: "acc_2", userId: "user_2", providerId: "okta", accountId: "okta|sam" },
  { rowId: "acc_3", userId: "user_3", providerId: "auth0", accountId: "waad|other|lee" },
];

function serviceOver(
  rows: FederatedAccountRow[],
  {
    members = ["user_1", "user_2", "user_3"],
    providerId = "waad|acme",
  }: { members?: string[]; providerId?: string } = {},
) {
  const held = new Map(rows.map((row) => [row.rowId, row]));
  const accounts = createApiFixture<BetterAuthHooksRepository>({
    findFederatedAccountsForUsers: async ({ userIds }) =>
      [...held.values()].filter((row) => userIds.includes(row.userId)),
    deleteAccounts: async ({ accountRowIds }) => {
      let deleted = 0;
      for (const rowId of accountRowIds) if (held.delete(rowId)) deleted += 1;
      return deleted;
    },
  });
  const memberships = createApiFixture<LegacySsoAccessMemberships>({
    listMemberIds: async ({ organizationId }) => (organizationId === ORG ? members : []),
  });
  const connections = createApiFixture<LegacySsoAccessConnections>({
    getProvider: async ({ connectionId }) => {
      if (connectionId !== LEGACY) throw new Error("sso_connection_not_found");
      return { providerId };
    },
  });

  return {
    service: LegacySsoAccessService.create({ accounts, memberships, connections }),
    held,
  };
}

const query = { organizationId: ORG, connectionId: LEGACY };

describe("the federated accounts a retiring connection still holds", () => {
  it("retires only the subjects that provider answers for", async () => {
    const { service, held } = serviceOver(ROWS);

    const outcome = await service.retire(query);

    expect(outcome).toEqual({ retired: 1, remaining: 0 });
    expect([...held.keys()]).toEqual(["acc_2", "acc_3"]);
  });

  it("counts what stands without retiring any of it", async () => {
    const { service, held } = serviceOver(ROWS, { members: ["user_2"], providerId: "okta" });

    const standing = await service.count(query);

    expect(standing).toBe(1);
    expect(held.size).toBe(3);
  });

  it("answers for nobody when the organization has no members", async () => {
    const { service, held } = serviceOver(ROWS, { members: [], providerId: "okta" });

    const outcome = await service.retire(query);

    expect(outcome).toEqual({ retired: 0, remaining: 0 });
    expect(held.size).toBe(3);
  });

  it("leaves a member of another organization on the same broker alone", async () => {
    const { service, held } = serviceOver(ROWS, { members: ["user_1"] });

    await service.retire(query);

    expect(held.has("acc_3")).toBe(true);
  });

  it("sweeps nothing for a connection the organization does not hold", async () => {
    const { service, held } = serviceOver(ROWS);

    await expect(
      service.retire({ organizationId: ORG, connectionId: "ssoc_other" }),
    ).rejects.toThrow("sso_connection_not_found");
    expect(held.size).toBe(3);
  });
});
