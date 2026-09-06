// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Unit coverage for the grant-repair paths of PersonalWorkspaceService.
 * The team commit and the owner's ADMIN grant are separate writes
 * (ADR-092 §13), so every path that hands back an existing workspace must
 * re-assert the grant rather than assume the write that created the team
 * also finished the append. The golden creation path is covered by
 * personalWorkspace.service.integration.test.ts against real Postgres.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import {
  AuthzLedgerUnavailableError,
  type GrantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";

vi.mock("~/server/app-layer/authz/ledger", async (importOriginal) => ({
  // Keep the real AuthzLedgerUnavailableError (and everything else) — only
  // the composed-writer factory is stubbed, and only because the service
  // must never reach for it: these tests always inject their own writer.
  ...(await importOriginal<typeof import("~/server/app-layer/authz/ledger")>()),
  grantsLedgerWriter: vi.fn(() => {
    throw new Error("unit test must inject its own writer");
  }),
}));

import { PersonalWorkspaceService } from "../personalWorkspace.service";

const USER_ID = "usr_pw_owner";
const ORG_ID = "org_pw";
const TEAM_ID = "team_pw";

const teamRow = {
  id: TEAM_ID,
  name: "Owner's Workspace",
  slug: "personal-owner-abc123",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  projects: [
    {
      id: "proj_pw",
      name: "Personal Workspace",
      slug: "personal-owner-def456",
      apiKey: "pkey_test",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

const makePrisma = () => {
  const prisma = {
    team: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
    },
    project: { create: vi.fn(), updateMany: vi.fn() },
    teamUser: { create: vi.fn() },
    roleBinding: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  };
  // Callback form: the service's transaction runs against this same mock so
  // the tests assert on one set of spies.
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => await fn(prisma),
  );
  return prisma;
};

const makeWriter = () =>
  ({
    attachBindings: vi.fn().mockResolvedValue({ attached: [], duplicates: [] }),
  }) as unknown as GrantsLedgerWriter;

const ownerAdminGrantOn = (teamId: string) =>
  expect.objectContaining({
    organizationId: ORG_ID,
    onDuplicate: "skip",
    bindings: [
      expect.objectContaining({
        principal: { userId: USER_ID },
        role: "ADMIN",
        scopeType: "TEAM",
        scopeId: teamId,
      }),
    ],
  });

describe("PersonalWorkspaceService.ensure", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let writer: GrantsLedgerWriter;
  let service: PersonalWorkspaceService;

  beforeEach(() => {
    prisma = makePrisma();
    writer = makeWriter();
    service = new PersonalWorkspaceService(prisma as unknown as PrismaClient, {
      writer,
    });
  });

  describe("when the workspace already exists", () => {
    describe("when the owner still holds a grant on the personal team", () => {
      it("returns the workspace without emitting a grant", async () => {
        prisma.team.findFirst.mockResolvedValueOnce(teamRow);
        prisma.roleBinding.findFirst.mockResolvedValueOnce({ id: "rb_1" });

        const result = await service.ensure({
          userId: USER_ID,
          organizationId: ORG_ID,
        });

        expect(result.created).toBe(false);
        expect(result.team.id).toBe(TEAM_ID);
        expect(writer.attachBindings).not.toHaveBeenCalled();
      });
    });

    describe("when an earlier ensure() died before the grant append", () => {
      it("re-asserts the owner's ADMIN grant on the personal team", async () => {
        prisma.team.findFirst.mockResolvedValueOnce(teamRow);
        prisma.roleBinding.findFirst.mockResolvedValueOnce(null);

        const result = await service.ensure({
          userId: USER_ID,
          organizationId: ORG_ID,
        });

        expect(result.created).toBe(false);
        expect(writer.attachBindings).toHaveBeenCalledWith(
          ownerAdminGrantOn(TEAM_ID),
        );
      });

      describe("when the grants ledger is unavailable", () => {
        it("still returns the workspace instead of failing sign-in", async () => {
          prisma.team.findFirst.mockResolvedValueOnce(teamRow);
          prisma.roleBinding.findFirst.mockResolvedValueOnce(null);
          (
            writer.attachBindings as ReturnType<typeof vi.fn>
          ).mockRejectedValueOnce(new AuthzLedgerUnavailableError());

          const result = await service.ensure({
            userId: USER_ID,
            organizationId: ORG_ID,
          });

          expect(result.created).toBe(false);
          expect(result.team.id).toBe(TEAM_ID);
        });

        it("does not await the projection, since nothing on this request reads it back", async () => {
          prisma.team.findFirst.mockResolvedValueOnce(teamRow);
          prisma.roleBinding.findFirst.mockResolvedValueOnce(null);

          await service.ensure({ userId: USER_ID, organizationId: ORG_ID });

          expect(writer.attachBindings).toHaveBeenCalledWith(
            expect.objectContaining({ awaitProjection: false }),
          );
        });

        it("propagates every other failure", async () => {
          prisma.team.findFirst.mockResolvedValueOnce(teamRow);
          prisma.roleBinding.findFirst.mockResolvedValueOnce(null);
          (
            writer.attachBindings as ReturnType<typeof vi.fn>
          ).mockRejectedValueOnce(new Error("boom"));

          await expect(
            service.ensure({ userId: USER_ID, organizationId: ORG_ID }),
          ).rejects.toThrow("boom");
        });
      });
    });
  });

  describe("when a concurrent ensure() won the create race (P2002)", () => {
    beforeEach(() => {
      // In-transaction lookups see nothing (live: null, archived: null), the
      // create loses to the winner's committed row, and the post-catch
      // re-fetch finds the winner's workspace.
      prisma.team.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(teamRow);
      prisma.team.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.0.0",
        }),
      );
    });

    describe("when the winner died before its own grant append", () => {
      it("repairs the owner grant on the race-loser return path", async () => {
        prisma.roleBinding.findFirst.mockResolvedValueOnce(null);

        const result = await service.ensure({
          userId: USER_ID,
          organizationId: ORG_ID,
        });

        expect(result.created).toBe(false);
        expect(result.team.id).toBe(TEAM_ID);
        expect(writer.attachBindings).toHaveBeenCalledWith(
          ownerAdminGrantOn(TEAM_ID),
        );
      });
    });

    describe("when the winner finished its grant append", () => {
      it("returns the winner's workspace without emitting a grant", async () => {
        prisma.roleBinding.findFirst.mockResolvedValueOnce({ id: "rb_1" });

        const result = await service.ensure({
          userId: USER_ID,
          organizationId: ORG_ID,
        });

        expect(result.created).toBe(false);
        expect(writer.attachBindings).not.toHaveBeenCalled();
      });
    });
  });
});
