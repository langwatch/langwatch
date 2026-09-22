// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A group belongs to the connection that pushed it. Reads hide a sibling
 * connection's group; writes acknowledge it exists and refuse the token's
 * authority. A legacy token keeps organization-wide reach, and so does a group
 * that predates connection scoping.
 */
import {
  ScimProtocolError,
  ScimWriteOutsideConnectionError,
} from "@langwatch/enterprise-scim-contract";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import type {
  ScimGroupMembershipRecord,
  ScimGroupRecord,
} from "../../repositories/scim.repository.ts";
import {
  ScimDirectoryService,
  type ScimDirectoryRepository,
  type ScimGroupMemberAuthority,
} from "../scim-directory.service.ts";
import { ScimGrantsService } from "../scim-grants.service.ts";

const ORGANIZATION = "org-1";
const OKTA = "connection-okta";
const ENTRA = "connection-entra";
/** A person some other directory asserted, whom this one may not write. */
const FOREIGN = "foreign-user";

function group(overrides: Partial<ScimGroupRecord> = {}): ScimGroupRecord {
  return {
    id: "group-1",
    organizationId: ORGANIZATION,
    name: "Engineering",
    slug: "engineering",
    scimSource: "scim",
    externalId: null,
    connectionId: null,
    createdAt: fromDate(new Date("2024-01-01T00:00:00Z")),
    updatedAt: fromDate(new Date("2024-01-02T00:00:00Z")),
    ...overrides,
  };
}

function repositoryOver(groups: ScimGroupRecord[]) {
  const created: { name: string; connectionId: string | null; externalId: string | null }[] = [];
  const reach = (candidate: ScimGroupRecord, connectionId?: string | null) =>
    !connectionId || candidate.connectionId === null || candidate.connectionId === connectionId;

  const repository: ScimDirectoryRepository = {
    findGroup: vi.fn(
      async (input: { organizationId: string; id: string }) =>
        groups.find((candidate) => candidate.id === input.id) ?? null,
    ),
    findGroupByExternalId: vi.fn(
      async (input: { organizationId: string; connectionId: string | null; externalId: string }) =>
        groups.find(
          (candidate) =>
            candidate.externalId === input.externalId &&
            candidate.connectionId === input.connectionId,
        ) ?? null,
    ),
    listGroups: vi.fn(
      async (input: {
        organizationId: string;
        connectionId?: string | null;
        displayName?: string;
        externalId?: string;
        startIndex: number;
        count: number;
      }) => {
        const rows = groups
          .filter(
            (candidate) =>
              reach(candidate, input.connectionId) &&
              (input.displayName === undefined || candidate.name === input.displayName) &&
              (input.externalId === undefined || candidate.externalId === input.externalId),
          )
          .map((candidate) => ({ ...candidate, members: [] as ScimGroupMembershipRecord[] }));

        return {
          rows: rows.slice(input.startIndex - 1, input.startIndex - 1 + input.count),
          total: rows.length,
        };
      },
    ),
    createGroup: vi.fn(
      async (input: {
        organizationId: string;
        name: string;
        slug: string;
        externalId: string | null;
        connectionId: string | null;
      }) => {
        created.push({
          name: input.name,
          connectionId: input.connectionId,
          externalId: input.externalId,
        });
        const made = group({
          id: `group-${String(groups.length + 1)}`,
          name: input.name,
          slug: input.slug,
          externalId: input.externalId,
          connectionId: input.connectionId,
        });
        groups.push(made);

        return made;
      },
    ),
    renameGroup: vi.fn(async () => undefined),
    deleteGroup: vi.fn(async () => undefined),
    listGroupMembers: vi.fn(async () => []),
    listGroupMemberIds: vi.fn(async () => []),
    addGroupMember: vi.fn(async () => undefined),
    removeGroupMembers: vi.fn(async () => undefined),
    groupSlugExists: vi.fn(async () => false),
    listRoleBindings: vi.fn(async () => []),
  };

  return { repository, created };
}

function serviceOver(
  repository: ScimDirectoryRepository,
  identities: ScimGroupMemberAuthority = { assertWritable: vi.fn(async () => undefined) },
) {
  return ScimDirectoryService.create({
    provenOffboarding: false,
    prisma: repository,
    grants: ScimGrantsService.create({ repository, grants: new GrantsFake() }),
    identities,
  });
}

describe("a group belongs to the connection that pushed it", () => {
  describe("when a directory pushes a new group", () => {
    /** @scenario "A group records the connection that pushed it" */
    it("records the connection on the group it creates", async () => {
      const { repository, created } = repositoryOver([]);

      await serviceOver(repository).createGroup({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          externalId: "okta-grp-1",
        },
      });

      expect(created).toEqual([
        { name: "Engineering", connectionId: OKTA, externalId: "okta-grp-1" },
      ]);
    });

    /** @scenario "A group echoes the identifier its directory sent" */
    it("echoes the directory's own identifier back on the group it created", async () => {
      const { repository } = repositoryOver([]);

      const created = await serviceOver(repository).createGroup({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          externalId: "okta-grp-1",
        },
      });

      expect(created.externalId).toBe("okta-grp-1");
    });

    /** @scenario "A group renamed in the directory stays one group" */
    it("recognises a renamed group by the identifier its directory means", async () => {
      const { repository, created } = repositoryOver([
        group({ id: "group-1", name: "Engineering", externalId: "okta-grp-1", connectionId: OKTA }),
      ]);

      const refusal = await serviceOver(repository)
        .createGroup({
          organizationId: ORGANIZATION,
          connectionId: OKTA,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            displayName: "Platform Engineering",
            externalId: "okta-grp-1",
          },
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimProtocolError);
      expect(created).toEqual([]);
    });

    /** @scenario "Two connections each carry their own group of the same name" */
    it("lets another connection push its own group of the same name", async () => {
      const { repository, created } = repositoryOver([
        group({ id: "group-1", name: "Engineering", externalId: "okta-grp-1", connectionId: OKTA }),
      ]);

      await serviceOver(repository).createGroup({
        organizationId: ORGANIZATION,
        connectionId: ENTRA,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          externalId: "entra-grp-9",
        },
      });

      expect(created).toEqual([
        { name: "Engineering", connectionId: ENTRA, externalId: "entra-grp-9" },
      ]);
    });
  });

  describe("when a token reads a group another connection pushed", () => {
    /** @scenario "A read hides a sibling connection's group" */
    it("answers not found rather than the sibling's group", async () => {
      const { repository } = repositoryOver([group({ connectionId: ENTRA })]);

      const refusal = await serviceOver(repository)
        .getGroup({ externalScimId: "group-1", organizationId: ORGANIZATION, connectionId: OKTA })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimProtocolError);
      expect((refusal as ScimProtocolError).response.status).toBe("404");
    });

    /** @scenario "A group that predates connection scoping stays visible" */
    it("keeps an unscoped group visible to every token in the organization", async () => {
      const { repository } = repositoryOver([group({ connectionId: null })]);

      const found = await serviceOver(repository).getGroup({
        externalScimId: "group-1",
        organizationId: ORGANIZATION,
        connectionId: OKTA,
      });

      expect(found.id).toBe("group-1");
    });

    /** @scenario "A legacy token keeps organization-wide reach" */
    it("lets a token belonging to no connection read every group", async () => {
      const { repository } = repositoryOver([group({ connectionId: ENTRA })]);

      const found = await serviceOver(repository).getGroup({
        externalScimId: "group-1",
        organizationId: ORGANIZATION,
        connectionId: null,
      });

      expect(found.id).toBe("group-1");
    });
  });

  describe("when a token writes to a group another connection pushed", () => {
    /** @scenario "A write to a sibling connection's group is refused by authority" */
    it("refuses the token's authority rather than answering not found", async () => {
      const { repository } = repositoryOver([group({ connectionId: ENTRA })]);

      const refusal = await serviceOver(repository)
        .deleteGroup({
          externalScimId: "group-1",
          organizationId: ORGANIZATION,
          connectionId: OKTA,
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimWriteOutsideConnectionError);
      expect(repository.deleteGroup).not.toHaveBeenCalled();
    });

    /** @scenario "A write to a sibling connection's group is refused by authority" */
    it("refuses a patch of a sibling connection's group the same way", async () => {
      const { repository } = repositoryOver([group({ connectionId: ENTRA })]);

      const refusal = await serviceOver(repository)
        .updateGroup({
          externalScimId: "group-1",
          organizationId: ORGANIZATION,
          connectionId: OKTA,
          patchRequest: {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            Operations: [{ op: "replace", path: "displayName", value: "Renamed" }],
          },
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ScimWriteOutsideConnectionError);
      expect(repository.renameGroup).not.toHaveBeenCalled();
    });
  });

  describe("when a push names people", () => {
    /** @scenario "A connection may only name people its own directory asserted" */
    it("asks the identity mapping about every member it names", async () => {
      const { repository } = repositoryOver([]);
      const identities = { assertWritable: vi.fn(async () => undefined) };

      await serviceOver(repository, identities).createGroup({
        organizationId: ORGANIZATION,
        connectionId: OKTA,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          members: [{ value: "user-1" }, { value: "user-2" }, { value: "user-1" }],
        },
      });

      expect(identities.assertWritable).toHaveBeenCalledTimes(2);
      expect(identities.assertWritable).toHaveBeenCalledWith({
        connectionId: OKTA,
        userId: "user-1",
      });
    });

    /** @scenario "A connection may only name people its own directory asserted" */
    it("asks nothing of the identity mapping for a legacy token", async () => {
      const { repository } = repositoryOver([]);
      const identities = { assertWritable: vi.fn(async () => undefined) };

      await serviceOver(repository, identities).createGroup({
        organizationId: ORGANIZATION,
        connectionId: null,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          displayName: "Engineering",
          members: [{ value: "user-1" }],
        },
      });

      expect(identities.assertWritable).not.toHaveBeenCalled();
    });

    /** @scenario "Group membership writes respect directory ownership" */
    it.each(["post", "put", "patch-add", "patch-remove", "patch-replace", "delete"])(
      "refuses a member a sibling directory owns, through %s, before writing anything",
      async (verb) => {
        const { repository } = repositoryOver(
          verb === "post" ? [] : [group({ connectionId: OKTA })],
        );
        repository.listGroupMemberIds = vi.fn(async () => [FOREIGN]);
        const identities = {
          assertWritable: vi.fn(async ({ userId }: { connectionId: string; userId: string }) => {
            if (userId === FOREIGN) throw new ScimWriteOutsideConnectionError({ userId });
          }),
        };

        const refusal = await foreignMemberWrite({
          verb,
          service: serviceOver(repository, identities),
        }).catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ScimWriteOutsideConnectionError);
        expect(repository.createGroup).not.toHaveBeenCalled();
        expect(repository.renameGroup).not.toHaveBeenCalled();
        expect(repository.deleteGroup).not.toHaveBeenCalled();
        expect(repository.addGroupMember).not.toHaveBeenCalled();
        expect(repository.removeGroupMembers).not.toHaveBeenCalled();
      },
    );
  });
});

/** Which member operation each patch verb stands for. */
const PATCH_OPS: Record<string, "remove" | "replace"> = {
  "patch-remove": "remove",
  "patch-replace": "replace",
};

/** The same foreign member, named through each write the protocol offers. */
function foreignMemberWrite({
  verb,
  service,
}: {
  verb: string;
  service: ScimDirectoryService;
}): Promise<unknown> {
  const target = { organizationId: ORGANIZATION, connectionId: OKTA };
  if (verb === "post") {
    return service.createGroup({
      ...target,
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Engineering",
        members: [{ value: FOREIGN }],
      },
    });
  }

  if (verb === "put") {
    return service.replaceGroup({
      ...target,
      externalScimId: "group-1",
      request: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Engineering",
        members: [{ value: FOREIGN }],
      },
    });
  }

  if (verb === "delete") {
    return service.deleteGroup({ ...target, externalScimId: "group-1" });
  }

  const op = PATCH_OPS[verb] ?? "add";

  return service.updateGroup({
    ...target,
    externalScimId: "group-1",
    patchRequest: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "add", path: "members", value: [{ value: "user-3" }] },
        { op, path: "members", value: [{ value: FOREIGN }] },
      ],
    },
  });
}
