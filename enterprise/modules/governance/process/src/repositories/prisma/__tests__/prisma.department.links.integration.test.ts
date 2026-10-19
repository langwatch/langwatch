// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/ai-gateway/governance/departments.feature (ADR-128 §13)
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, Prisma } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaDepartmentRepository } from "../prisma.department.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:department-links"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

describe.skipIf(!connection)("PrismaDepartmentRepository dated department links", () => {
  const ns = `dept-links-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const ROBIN = `usr-robin-${ns}`;
  const MORGAN = `usr-morgan-${ns}`;
  const SASHA = `usr-sasha-${ns}`;
  const members = [ROBIN, MORGAN, SASHA];

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaDepartmentRepository.create(prisma());
  const assign = (userId: string, departmentId: string | null) =>
    repository().recordMemberDepartment({
      organizationId: ORG_ID,
      userId,
      departmentId,
      at: fromDate(new Date()),
    });
  const links = (userId: string) =>
    prisma().departmentMembershipHistory.findMany({
      where: { organizationId: ORG_ID, userId },
      orderBy: { validFrom: "asc" },
    });

  beforeAll(async () => {
    await prisma().organization.create({ data: { id: ORG_ID, name: ns, slug: ORG_ID } });
    await prisma().user.createMany({
      data: members.map((id) => ({ id, email: `${id}@example.com`, name: id })),
    });
    await prisma().organizationUser.createMany({
      data: members.map((userId) => ({
        organizationId: ORG_ID,
        userId,
        role: OrganizationUserRole.MEMBER,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma().departmentMembershipHistory.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma().organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma().user.deleteMany({ where: { id: { in: members } } });
    await prisma().organization.deleteMany({ where: { id: ORG_ID } });
  });

  /** @scenario "A reorg closes the old dated link and opens a new one" */
  it("dates every assignment: open on assign, closed on reassign, closed-only on clear", async () => {
    await assign(MORGAN, `support-${ns}`);
    await assign(MORGAN, `support-${ns}`);
    let history = await links(MORGAN);
    expect(history).toHaveLength(1);
    expect(history[0]?.departmentId).toBe(`support-${ns}`);
    expect(history[0]?.validTo).toBeNull();

    await assign(MORGAN, `legal-${ns}`);
    history = await links(MORGAN);
    expect(history).toHaveLength(2);
    expect(history[0]?.validTo).not.toBeNull();
    expect(history[1]?.departmentId).toBe(`legal-${ns}`);
    expect(history[1]?.validTo).toBeNull();

    await assign(MORGAN, null);
    history = await links(MORGAN);
    expect(history.filter((link) => link.validTo === null)).toHaveLength(0);
  });

  /** @scenario "A past day resolves to the department whose link covered it" */
  it("resolves a past day against the link that was open then, not today's pointer", async () => {
    await prisma().departmentMembershipHistory.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: ROBIN,
          departmentId: `jan-${ns}`,
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validTo: new Date("2026-02-01T00:00:00.000Z"),
        },
        {
          organizationId: ORG_ID,
          userId: ROBIN,
          departmentId: `feb-${ns}`,
          validFrom: new Date("2026-02-01T00:00:00.000Z"),
          validTo: new Date("2026-03-01T00:00:00.000Z"),
        },
      ],
    });
    const onDay = (dayUtc: string) =>
      repository().findMemberDepartmentsOnDay({
        organizationId: ORG_ID,
        userIds: [ROBIN],
        dayUtc,
      });

    expect(await onDay("2026-01-15")).toEqual([{ userId: ROBIN, departmentId: `jan-${ns}` }]);
    expect(await onDay("2026-02-15")).toEqual([{ userId: ROBIN, departmentId: `feb-${ns}` }]);
    expect(await onDay("2025-12-15")).toEqual([]);
  });

  /** @scenario "A standing assignment from before dated links gets its link seeded" */
  it("seeds a dated link when the re-asserted pointer has none", async () => {
    await assign(SASHA, `standing-${ns}`);

    const history = await links(SASHA);
    expect(history).toHaveLength(1);
    expect(history[0]?.departmentId).toBe(`standing-${ns}`);
    expect(history[0]?.validTo).toBeNull();
  });

  it("rejects a second open link at the database, not by discipline", async () => {
    await assign(ROBIN, `guard-${ns}`);

    await expect(
      prisma().departmentMembershipHistory.create({
        data: {
          organizationId: ORG_ID,
          userId: ROBIN,
          departmentId: `guard-${ns}`,
          validFrom: new Date(),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });
});
