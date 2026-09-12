// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What the department sync does with an identity link that already exists.
 *
 * The proof rule itself is exercised against real join paths in
 * `directoryDepartmentSync.integration.test.ts`; this file is the seam above
 * it — every read is a stub, so the only thing under test is which account a
 * directory row's department lands on when an accepted link disagrees with the
 * directory index.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 * Decision: ADR-128 §12
 */
import { describe, expect, it } from "vitest";

import type { DepartmentService } from "@langwatch/enterprise-governance-server";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  DiscoveredPersonRepository,
  IdentityMatchRepository,
} from "../../repositories/governanceIdentity.repository";
import { DirectoryDepartmentSyncService } from "../directoryDepartmentSync.service";
import type { IdentityMatchService } from "../identityMatch.service";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../../../../../modules/governance/server/src/services/dataverse-environment.service.ts";
import { DIRECTORY_REPORT_ACTION } from "../../../../../../modules/governance/server/src/services/microsoftGraphDirectory.ts";

const organizationId = "org_dirdept_unit";
const provider = COPILOT_STUDIO_DATAVERSE_ADAPTER_ID;

const MARIA_OID = "f6481ec4-0000-4000-8000-0000000000a1";
const LINKED_USER = "user_linked";
const DIRECTORY_USER = "user_from_stale_directory_id";
const DEPARTMENT_ID = "dept_engineering";

const directoryEvent = ({
  actor,
  mail = "",
  department,
}: {
  actor: string;
  mail?: string;
  department: string;
}): NormalizedPullEvent => ({
  source_event_id: "dir_1",
  event_timestamp: "2026-09-03T00:00:00.000Z",
  actor,
  action: DIRECTORY_REPORT_ACTION,
  target: department,
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
  raw_payload: "{}",
  extra: { directoryId: actor, mail, department },
});

/**
 * The two reads `assignWhereChanged` makes straight off the client, stubbed so
 * every candidate reads as a member of the organization carrying no department
 * yet — the state in which any assignment at all is a write.
 */
const prismaStub = () =>
  ({
    organizationUser: {
      findMany: async ({ where }: { where: { userId: { in: string[] } } }) =>
        where.userId.in.map((userId) => ({ userId, departmentId: null })),
    },
    departmentMembershipHistory: { findMany: async () => [] },
  }) as unknown as PrismaClient;

/** Records every assignment the sync asked for, in order. */
const departmentsStub = () => {
  const assignments: { userId: string; departmentId: string | null }[] = [];
  const service = {
    resolveByNameOrCreate: async () => ({ id: DEPARTMENT_ID }),
    assignUser: async (params: {
      organizationId: string;
      userId: string;
      departmentId: string | null;
    }) => {
      assignments.push({
        userId: params.userId,
        departmentId: params.departmentId,
      });
    },
  } as unknown as DepartmentService;
  return { service, assignments };
};

const matcherStub = ({
  usersByVerifiedEmail = new Map<string, string[]>(),
  usersByDirectoryId = new Map<string, string[]>(),
}: {
  usersByVerifiedEmail?: Map<string, string[]>;
  usersByDirectoryId?: Map<string, string[]>;
}) =>
  ({
    loadAccountIndex: async () => ({
      usersByVerifiedEmail,
      usersByDirectoryId,
    }),
  }) as unknown as IdentityMatchService;

const peopleStub = (rows: { id: string; rawActorId: string }[]) =>
  ({
    findByActorIds: async () => rows,
  }) as unknown as DiscoveredPersonRepository;

const matchesStub = (
  rows: { discoveredPersonId: string; userId: string | null }[],
) =>
  ({
    findOpenByOrganization: async () => rows,
  }) as unknown as IdentityMatchRepository;

describe("Feature: the department sync reads the accepted identity link", () => {
  describe("given the directory row's identifier names a different account than the accepted link", () => {
    /** @scenario "An accepted identity link outranks a disagreeing directory row" */
    it("assigns the department to the linked account and never to the directory's", async () => {
      const departments = departmentsStub();
      const service = new DirectoryDepartmentSyncService({
        prisma: prismaStub(),
        departments: departments.service,
        // A stale `ScimExternalId` still points this directory id at somebody
        // else. No confirmed address is in play, so nothing else can settle it.
        matcher: matcherStub({
          usersByDirectoryId: new Map([[MARIA_OID, [DIRECTORY_USER]]]),
        }),
        discoveredPeople: peopleStub([
          { id: "person_1", rawActorId: MARIA_OID },
        ]),
        matches: matchesStub([
          { discoveredPersonId: "person_1", userId: LINKED_USER },
        ]),
      });

      const outcome = await service.applyDirectoryEvents({
        organizationId,
        provider,
        events: [
          directoryEvent({ actor: MARIA_OID, department: "Engineering" }),
        ],
      });

      expect(outcome.assigned).toBe(1);
      expect(departments.assignments).toEqual([
        { userId: LINKED_USER, departmentId: DEPARTMENT_ID },
      ]);
    });
  });

  describe("given the person holds no identity link", () => {
    it("assigns through the directory identifier exactly as before", async () => {
      const departments = departmentsStub();
      const service = new DirectoryDepartmentSyncService({
        prisma: prismaStub(),
        departments: departments.service,
        matcher: matcherStub({
          usersByDirectoryId: new Map([[MARIA_OID, [DIRECTORY_USER]]]),
        }),
        discoveredPeople: peopleStub([
          { id: "person_1", rawActorId: MARIA_OID },
        ]),
        matches: matchesStub([]),
      });

      const outcome = await service.applyDirectoryEvents({
        organizationId,
        provider,
        events: [
          directoryEvent({ actor: MARIA_OID, department: "Engineering" }),
        ],
      });

      expect(outcome.assigned).toBe(1);
      expect(departments.assignments).toEqual([
        { userId: DIRECTORY_USER, departmentId: DEPARTMENT_ID },
      ]);
    });
  });

  describe("given a confirmed address names an account the accepted link does not", () => {
    it("assigns nobody, because the contradiction halts the row", async () => {
      const departments = departmentsStub();
      const service = new DirectoryDepartmentSyncService({
        prisma: prismaStub(),
        departments: departments.service,
        matcher: matcherStub({
          usersByVerifiedEmail: new Map([
            ["m.silva@acme.test", [DIRECTORY_USER]],
          ]),
        }),
        discoveredPeople: peopleStub([
          { id: "person_1", rawActorId: MARIA_OID },
        ]),
        matches: matchesStub([
          { discoveredPersonId: "person_1", userId: LINKED_USER },
        ]),
      });

      const outcome = await service.applyDirectoryEvents({
        organizationId,
        provider,
        events: [
          directoryEvent({
            actor: MARIA_OID,
            mail: "m.silva@acme.test",
            department: "Engineering",
          }),
        ],
      });

      expect(outcome.assigned).toBe(0);
      expect(departments.assignments).toEqual([]);
    });
  });

  describe("given an erasure blanked the account off the link", () => {
    it("treats the person as unlinked rather than as spoken for", async () => {
      const departments = departmentsStub();
      const service = new DirectoryDepartmentSyncService({
        prisma: prismaStub(),
        departments: departments.service,
        matcher: matcherStub({
          usersByDirectoryId: new Map([[MARIA_OID, [DIRECTORY_USER]]]),
        }),
        discoveredPeople: peopleStub([
          { id: "person_1", rawActorId: MARIA_OID },
        ]),
        // What `findOpenByOrganization` actually returns for a blanked link:
        // nothing. Stubbed as the row it filters out would be, so a future
        // change that stops filtering fails here rather than in production.
        matches: matchesStub([
          { discoveredPersonId: "person_1", userId: null },
        ]),
      });

      const outcome = await service.applyDirectoryEvents({
        organizationId,
        provider,
        events: [
          directoryEvent({ actor: MARIA_OID, department: "Engineering" }),
        ],
      });

      expect(outcome.assigned).toBe(1);
      expect(departments.assignments).toEqual([
        { userId: DIRECTORY_USER, departmentId: DEPARTMENT_ID },
      ]);
    });
  });
});
