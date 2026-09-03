// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The People screen's server-side joins against real rows: the open link and
 * its evidence beside the person, the linked member's department read
 * through the membership, and the erased row showing its stand-in.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { GovernancePeopleScreenService } from "../governancePeopleScreen.service";

const ns = nanoid(8);
const organizationId = `org_pscreen_${ns}`;
const mariaUserId = `user_ps_maria_${ns}`;

const service = () => GovernancePeopleScreenService.create(prisma);

describe("Feature: the People screen shows who the providers named", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "People Screen Org",
        slug: `--test-pscreen-${ns}`,
      },
    });
    await prisma.user.create({
      data: {
        id: mariaUserId,
        name: "Maria Silva",
        email: `m.silva-${ns}@acme.test`,
        emailVerified: true,
      },
    });
    const department = await prisma.department.create({
      data: { organizationId, name: "Engineering" },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId,
        userId: mariaUserId,
        role: "MEMBER",
        departmentId: department.id,
      },
    });

    const seenAt = new Date("2026-08-01T00:00:00.000Z");
    const person = (id: string, over: Record<string, unknown>) =>
      prisma.discoveredPerson.create({
        data: {
          id: `${id}_${ns}`,
          organizationId,
          provider: "openai_admin",
          rawActorId: `${id}@acme.test`,
          displayText: `${id}@acme.test`,
          kind: "person",
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          ...over,
        },
      });

    await person("linked", {});
    await person("stranger", {});
    await person("gone", {
      rawActorId: "pseudonym_xyz",
      displayText: "pseudonym_xyz",
      erasedAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    await prisma.identityMatch.create({
      data: {
        organizationId,
        discoveredPersonId: `linked_${ns}`,
        userId: mariaUserId,
        evidenceKind: "verified_email",
        validFrom: seenAt,
      },
    });
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["identityMatch", { organizationId }],
      ["discoveredPerson", { organizationId }],
      ["department", { organizationId }],
      ["organizationUser", { organizationId }],
      ["user", { id: mariaUserId }],
      ["organization", { id: organizationId }],
    ]),
  );

  it("shows the link, its proof, and the member's department on a linked person", async () => {
    const people = await service().listPeople({ organizationId });

    const linked = people.find((p) => p.id === `linked_${ns}`);
    expect(linked?.link).toMatchObject({
      userId: mariaUserId,
      evidenceKind: "verified_email",
      memberName: "Maria Silva",
      departmentName: "Engineering",
    });
  });

  it("shows an unlinked person with no link and no department", async () => {
    const people = await service().listPeople({ organizationId });

    const stranger = people.find((p) => p.id === `stranger_${ns}`);
    expect(stranger?.link).toBeNull();
  });

  it("shows an erased person as erased, wearing the stand-in text", async () => {
    const people = await service().listPeople({ organizationId });

    const gone = people.find((p) => p.id === `gone_${ns}`);
    expect(gone?.erasedAt).not.toBeNull();
    expect(gone?.displayText).toBe("pseudonym_xyz");
    expect(gone?.rawActorId).toBe("pseudonym_xyz");
  });
});
