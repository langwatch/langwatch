// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The directory's department field landing on real rows: real members, real
 * `Department` rows through `resolveByNameOrCreate`, real assignments on the
 * membership. What lives here is the proof rule against actual join paths —
 * a confirmed address, an unconfirmed one, the SSO connection's directory id
 * — and the idempotence of a read that runs every day.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 * Decision: ADR-128 §10–12
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { DirectoryDepartmentSyncService } from "../directoryDepartmentSync.service";
import { DIRECTORY_REPORT_ACTION } from "../pullers/microsoftGraphDirectory";
import type { NormalizedPullEvent } from "../pullers/pullerAdapter";

const ns = nanoid(8);
const organizationId = `org_dirdept_${ns}`;
const mariaUserId = `user_dd_maria_${ns}`;
const jonasUserId = `user_dd_jonas_${ns}`;
const connectionId = `sso_dd_${ns}`;

const MARIA_OID = "f6481ec4-0000-4000-8000-000000000001";
const JONAS_OID = "f6481ec4-0000-4000-8000-000000000002";
const STRANGER_OID = "f6481ec4-0000-4000-8000-000000000003";

const service = () => DirectoryDepartmentSyncService.create(prisma);

const directoryEvent = (over: {
  actor: string;
  mail?: string;
  department?: string;
}): NormalizedPullEvent => ({
  source_event_id: `dir_${nanoid(6)}`,
  event_timestamp: "2026-09-03T00:00:00.000Z",
  actor: over.actor,
  action: DIRECTORY_REPORT_ACTION,
  target: over.department ?? "",
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
  raw_payload: "{}",
  extra: {
    directoryId: over.actor,
    displayName: "",
    mail: over.mail ?? "",
    userPrincipalName: "",
    department: over.department ?? "",
    accountEnabled: true,
  },
});

const membership = (userId: string) =>
  prisma.organizationUser.findFirstOrThrow({
    where: { organizationId, userId },
    select: { departmentId: true },
  });

const departments = () =>
  prisma.department.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });

describe("Feature: directory departments land on the entities we already have", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Directory Dept Org",
        slug: `--test-dirdept-${ns}`,
      },
    });

    const member = async (
      id: string,
      name: string,
      email: string,
      verified: boolean,
    ) => {
      await prisma.user.create({
        data: { id, name, email, emailVerified: verified },
      });
      await prisma.organizationUser.create({
        data: { organizationId, userId: id, role: "MEMBER" },
      });
    };
    await member(mariaUserId, "Maria Silva", `m.silva-${ns}@acme.test`, true);
    // Jonas never confirmed his address; his proof, if any, is the directory id.
    await member(
      jonasUserId,
      "Jonas Bakker",
      `j.bakker-${ns}@acme.test`,
      false,
    );

    const at = new Date("2026-09-01T00:00:00.000Z");
    await prisma.ssoConnection.create({
      data: {
        id: connectionId,
        organizationId,
        type: "oidc",
        state: "ACTIVE",
        idpMetadata: {},
        source: "self-serve",
        occurredAt: at,
        lastEventId: `evt_${ns}`,
        acceptedAt: at,
        projectionVersion: "1",
        createdAt: at,
        updatedAt: at,
      },
    });
    await prisma.scimExternalId.create({
      data: { connectionId, externalId: JONAS_OID, userId: jonasUserId },
    });
  });

  beforeEach(async () => {
    await prisma.organizationUser.updateMany({
      where: { organizationId },
      data: { departmentId: null },
    });
    await cleanupTestRows(prisma, [["department", { organizationId }]]);
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["department", { organizationId }],
      ["scimExternalId", { connectionId }],
      ["ssoConnection", { id: connectionId }],
      ["organizationUser", { organizationId }],
      ["user", { id: { in: [mariaUserId, jonasUserId] } }],
      ["organization", { id: organizationId }],
    ]),
  );

  it("assigns a member their directory department through a confirmed address", async () => {
    await prisma.department.create({
      data: { organizationId, name: "Engineering" },
    });

    const outcome = await service().applyDirectoryEvents({
      organizationId,
      events: [
        directoryEvent({
          actor: MARIA_OID,
          mail: `m.silva-${ns}@acme.test`,
          department: "Engineering",
        }),
      ],
    });

    expect(outcome.assigned).toBe(1);
    const rows = await departments();
    expect(rows).toHaveLength(1);
    expect((await membership(mariaUserId)).departmentId).toBe(rows[0]?.id);
  });

  it("creates a department the organization has not created yet — the SCIM costCenter call", async () => {
    await service().applyDirectoryEvents({
      organizationId,
      events: [
        directoryEvent({
          actor: MARIA_OID,
          mail: `m.silva-${ns}@acme.test`,
          department: "Field Research",
        }),
      ],
    });

    const rows = await departments();
    expect(rows.map((d) => d.name)).toEqual(["Field Research"]);
    expect((await membership(mariaUserId)).departmentId).toBe(rows[0]?.id);
  });

  it("assigns through the SSO connection's directory id when no address is confirmed", async () => {
    const outcome = await service().applyDirectoryEvents({
      organizationId,
      events: [
        directoryEvent({
          actor: JONAS_OID,
          // The unconfirmed address alone would prove nothing; the id does.
          mail: `j.bakker-${ns}@acme.test`,
          department: "Operations",
        }),
      ],
    });

    expect(outcome.assigned).toBe(1);
    expect((await membership(jonasUserId)).departmentId).not.toBeNull();
  });

  it("assigns nobody from a row that proves nobody, and creates no department for it", async () => {
    const outcome = await service().applyDirectoryEvents({
      organizationId,
      events: [
        directoryEvent({
          actor: STRANGER_OID,
          mail: `nobody-${ns}@acme.test`,
          department: "Marketing",
        }),
      ],
    });

    expect(outcome.assigned).toBe(0);
    expect(await departments()).toHaveLength(0);
  });

  it("leaves a hand-assigned member alone when their directory department is blank", async () => {
    const dept = await prisma.department.create({
      data: { organizationId, name: "Platform" },
    });
    await prisma.organizationUser.updateMany({
      where: { organizationId, userId: mariaUserId },
      data: { departmentId: dept.id },
    });

    await service().applyDirectoryEvents({
      organizationId,
      events: [
        directoryEvent({
          actor: MARIA_OID,
          mail: `m.silva-${ns}@acme.test`,
          department: "",
        }),
      ],
    });

    expect((await membership(mariaUserId)).departmentId).toBe(dept.id);
  });

  it("costs nothing to run twice — one department, same assignment, no write reported", async () => {
    const events = [
      directoryEvent({
        actor: MARIA_OID,
        mail: `m.silva-${ns}@acme.test`,
        department: "Engineering",
      }),
    ];

    const first = await service().applyDirectoryEvents({
      organizationId,
      events,
    });
    const second = await service().applyDirectoryEvents({
      organizationId,
      events,
    });

    expect(first.assigned).toBe(1);
    expect(second.assigned).toBe(0);
    expect(await departments()).toHaveLength(1);
  });
});
