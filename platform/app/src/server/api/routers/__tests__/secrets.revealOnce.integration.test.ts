/**
 * @vitest-environment node
 *
 * A virtual key minted from the app with `revealOnce`, and the one read of
 * its secret through `secrets.revealOnce`
 * (specs/langy/langy-secret-snippet.feature). Real Postgres, the real
 * routers, the real one-time reveal store; the only boundary stubbed is the
 * composition root the reveal store reads Redis from, which answers with no
 * Redis so the store runs on its in-process map.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `sealed:${Buffer.from(text).toString("base64")}`,
  decrypt: (text: string) =>
    Buffer.from(text.replace(/^sealed:/, ""), "base64").toString(),
}));

import { prisma } from "../../../db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("virtualKeys.create with revealOnce, then secrets.revealOnce", () => {
  const ns = `reveal-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const OTHER_ORG_ID = `org-other-${ns}`;
  const TEAM_ID = `team-${ns}`;
  const PROJECT_ID = `proj-${ns}`;
  const ADMIN = `usr-admin-${ns}`;
  const OUTSIDER = `usr-outsider-${ns}`;

  function callerFor(userId: string): Caller {
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: userId, email: `${userId}@example.com`, name: userId },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: ns, slug: ORG_ID },
        { id: OTHER_ORG_ID, name: `other-${ns}`, slug: OTHER_ORG_ID },
      ],
    });
    await prisma.user.createMany({
      data: [ADMIN, OUTSIDER].map((id) => ({
        id,
        email: `${id}@example.com`,
        name: id,
      })),
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: ADMIN,
          role: OrganizationUserRole.ADMIN,
        },
        {
          organizationId: OTHER_ORG_ID,
          userId: OUTSIDER,
          role: OrganizationUserRole.ADMIN,
        },
      ],
    });
    await prisma.roleBinding.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: ADMIN,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: ORG_ID,
        },
        {
          organizationId: OTHER_ORG_ID,
          userId: OUTSIDER,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: OTHER_ORG_ID,
        },
      ],
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: TEAM_ID,
        slug: TEAM_ID,
        organizationId: ORG_ID,
        members: { create: { userId: ADMIN, role: TeamUserRole.ADMIN } },
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.teamUser.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN, OUTSIDER] } } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await stopTestContainers();
  });

  async function mintWithReveal() {
    return callerFor(ADMIN).virtualKeys.create({
      organizationId: ORG_ID,
      name: `production-app-${nanoid(4)}`,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      traceProjectId: PROJECT_ID,
      revealOnce: true,
    });
  }

  describe("when the app mints a key with revealOnce", () => {
    /** @scenario "The tRPC create with revealOnce keeps the secret and adds the reveal id" */
    it("returns the secret for the dialog, plus a reveal id and the prefix that read the same secret once", async () => {
      const created = await mintWithReveal();
      expect(created.secret).toMatch(/^vk-lw-[0-9A-Z]{26}$/);
      expect(created.revealId).toMatch(/^rvl_/);
      expect(created.preview).toBe(created.secret.slice(0, 13));

      const revealed = await callerFor(ADMIN).secrets.revealOnce({
        organizationId: ORG_ID,
        revealId: created.revealId!,
      });
      expect(revealed).toEqual({
        kind: "virtual_key",
        keyId: created.virtualKey.id,
        preview: created.preview,
        secret: created.secret,
      });

      await expect(
        callerFor(ADMIN).secrets.revealOnce({
          organizationId: ORG_ID,
          revealId: created.revealId!,
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "secret_already_revealed" }),
      });
    });

    it("answers with no reveal id when revealOnce is not asked for", async () => {
      const created = await callerFor(ADMIN).virtualKeys.create({
        organizationId: ORG_ID,
        name: `plain-${nanoid(4)}`,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        traceProjectId: PROJECT_ID,
      });
      expect(created).not.toHaveProperty("revealId");
      expect(created).not.toHaveProperty("preview");
    });
  });

  describe("when a reveal id is read from outside the organization", () => {
    it("is refused by the permission gate, and the secret stays for the organization", async () => {
      const created = await mintWithReveal();
      await expect(
        callerFor(OUTSIDER).secrets.revealOnce({
          organizationId: ORG_ID,
          revealId: created.revealId!,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        callerFor(OUTSIDER).secrets.revealOnce({
          organizationId: OTHER_ORG_ID,
          revealId: created.revealId!,
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "secret_reveal_expired" }),
      });
      const revealed = await callerFor(ADMIN).secrets.revealOnce({
        organizationId: ORG_ID,
        revealId: created.revealId!,
      });
      expect(revealed.secret).toBe(created.secret);
    });
  });

  describe("when a reveal id was never stashed", () => {
    /** @scenario "A reveal id that never existed or has expired is refused" */
    it("is refused as expired", async () => {
      await expect(
        callerFor(ADMIN).secrets.revealOnce({
          organizationId: ORG_ID,
          revealId: "rvl_never",
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "secret_reveal_expired" }),
      });
    });
  });
});
