/**
 * What the directory did to an organization's grants, newest first. Only its
 * own grants count: an administrator's grant at the same scope carries
 * another source and is no evidence about a sync.
 */
import { describe, expect, it, vi } from "vitest";

import { EventingAuthzGrantRepository } from "../../repositories/eventing/eventing.authz-grant.repository.ts";

const ORG_ID = "org_acme";

function repositoryOver({
  attached,
  removed,
}: {
  attached: { id: string; principalId: string; createdAt: Date }[];
  removed: { id: string; principalId: string; revokedAt: Date }[];
}) {
  const findMany = vi
    .fn()
    .mockImplementationOnce(async () => attached)
    .mockImplementationOnce(async () => removed);
  const database = { grant: { findMany } };
  return {
    findMany,
    repository: EventingAuthzGrantRepository.create({
      database: database as never,
      writer: {} as never,
      selectHead: async () => true,
    }),
  };
}

describe("given the directory has attached and taken back grants", () => {
  it("answers both, newest first, capped at the limit asked for", async () => {
    const { repository, findMany } = repositoryOver({
      attached: [{ id: "grant_new", principalId: "user_1", createdAt: new Date(3000) }],
      removed: [{ id: "grant_old", principalId: "user_2", revokedAt: new Date(5000) }],
    });

    const changes = await repository.findDirectoryCausedChanges({
      organizationId: ORG_ID,
      limit: 5,
    });

    expect(changes).toEqual([
      { grantId: "grant_old", userId: "user_2", kind: "removed", occurredAtMs: 5000 },
      { grantId: "grant_new", userId: "user_1", kind: "attached", occurredAtMs: 3000 },
    ]);
    // Only what the directory wrote, and only this organization's.
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      organizationId: ORG_ID,
      source: "scim",
      scopeId: ORG_ID,
    });
  });

  it("never answers more rows than the caller asked to read", async () => {
    const { repository } = repositoryOver({
      attached: [
        { id: "grant_a", principalId: "user_1", createdAt: new Date(4000) },
        { id: "grant_b", principalId: "user_2", createdAt: new Date(3000) },
      ],
      removed: [{ id: "grant_c", principalId: "user_3", revokedAt: new Date(2000) }],
    });

    const changes = await repository.findDirectoryCausedChanges({
      organizationId: ORG_ID,
      limit: 2,
    });

    expect(changes.map((change) => change.grantId)).toEqual(["grant_a", "grant_b"]);
  });
});

describe("given the directory has done nothing here", () => {
  it("answers an empty page rather than nothing at all", async () => {
    const { repository } = repositoryOver({ attached: [], removed: [] });

    expect(
      await repository.findDirectoryCausedChanges({ organizationId: ORG_ID, limit: 10 }),
    ).toEqual([]);
  });
});
