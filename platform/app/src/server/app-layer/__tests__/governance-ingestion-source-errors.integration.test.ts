/**
 * @vitest-environment node
 *
 * The failure paths of the ingestion-source slice, which had no coverage at
 * all: `assertPullSchedule`, `IngestionSourceNotFoundError`, and the
 * `requireById` guard the mutations share.
 *
 * Every assertion is on `code` — never on message prose. Since #5984 the wire
 * message for a handled error IS the code slug, and the sentence a customer
 * reads comes from the client presentation registry keyed by that code. What
 * the tests do pin is `meta`, because `meta` is the client contract: it is
 * the only channel carrying the specific complaint (which cron was wrong,
 * which id was missing) to whatever renders it.
 *
 * Both entry points matter and are exercised separately. The service is
 * deliberately reachable from background workers and webhook adapters that
 * have no tRPC boundary, so a refusal has to be meaningful as a raw
 * `HandledError` and not only after the router has wrapped it.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import type { App } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import type { Session } from "~/server/auth";
import { prisma } from "~/server/db";
import { cleanupTestRows, requireAssigned } from "~/test-utils/cleanupTestRows";

const ns = `src-err-${nanoid(8)}`;
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

let organizationId: string;
let adminUserId: string;
const app: App = createTestApp({
  planProvider: PlanProviderService.create({
    getActivePlan: async () => enterprisePlan,
  }),
});

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Source Errors Org ${ns}`, slug: `--src-err-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `Source Errors Team ${ns}`,
      slug: `--src-err-team-${ns}`,
      organizationId,
    },
  });

  const admin = await prisma.user.create({
    data: { name: "Admin", email: `src-err-admin-${ns}@example.com` },
  });
  adminUserId = admin.id;
  await prisma.organizationUser.create({
    data: {
      userId: admin.id,
      organizationId,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.teamUser.create({
    data: { userId: admin.id, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId,
      userId: admin.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });
});

afterAll(async () => {
  // The governance slice provisions its own internal project, so the team
  // cannot be deleted until that project goes first. ProjectSecret's tenancy
  // guard demands literal project ids, so they are collected first, anchored
  // so a broken setup cannot widen the findMany into every project in the
  // database.
  const projectIds = (
    await prisma.project.findMany({
      where: {
        team: {
          organizationId: requireAssigned({
            value: organizationId,
            name: "organizationId",
          }),
        },
      },
      select: { id: true },
    })
  ).map((project) => project.id);
  await cleanupTestRows(prisma, [
    ["ingestionSource", { organizationId }],
    ["roleBinding", { organizationId }],
    ["teamUser", { team: { organizationId } }],
    ["organizationUser", { organizationId }],
    ["projectSecret", { projectId: { in: projectIds } }],
    ["project", { team: { organizationId } }],
    ["team", { organizationId }],
    ["organization", { slug: `--src-err-${ns}` }],
    ["user", { email: `src-err-admin-${ns}@example.com` }],
  ]);
});

function callerFor(userId: string) {
  const session: Session = { user: { id: userId }, expires: "1" };
  const ctx = createInnerTRPCContext({
    session,
    app,
  });
  return appRouter.createCaller(ctx);
}

describe("IngestionSource failure paths", () => {
  describe("given a malformed pullSchedule", () => {
    // Not a five-field cron, and not parseable as one — the everyday typo in
    // a free-text box. Before this was a `ValidationError` it arrived as an
    // INTERNAL_SERVER_ERROR: the admin read "Something went wrong — we've
    // been notified" about their own mistake, and it booked a 5xx incident.
    const badCron = "*/5 * * *";

    describe("when the source is created through the router", () => {
      it("rejects with validation_error and a non-empty formErrors", async () => {
        await expect(
          callerFor(adminUserId).ingestionSources.create({
            organizationId,
            sourceType: "otel_generic",
            name: `bad-cron-create-${ns}`,
            pullSchedule: badCron,
          }),
        ).rejects.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          cause: { code: "validation_error" },
        });

        const persisted = await prisma.ingestionSource.findFirst({
          where: { organizationId, name: `bad-cron-create-${ns}` },
        });
        expect(persisted).toBeNull();
      });
    });

    describe("when the service is called directly", () => {
      it("carries the zod complaints in meta.formErrors", async () => {
        const service = app.governance;
        const error = await service
          .ingestionSourceCreate({
            organizationId,
            sourceType: "otel_generic",
            name: `bad-cron-service-${ns}`,
            pullSchedule: badCron,
            actorUserId: adminUserId,
          })
          .then(
            () => null,
            (err: unknown) => err,
          );

        expect(error).not.toBeNull();
        expect(error).toMatchObject({
          code: "validation_error",
          httpStatus: 422,
        });
        // The complaint is the whole value of this error, and `formErrors` is
        // the half something reads — the registry's `validation_error` copy
        // renders it when the field name isn't one it can name, which
        // `pullSchedule` is not.
        const formErrors = (error as { meta: { formErrors?: unknown } }).meta.formErrors;
        expect(Array.isArray(formErrors)).toBe(true);
        expect(formErrors as string[]).not.toHaveLength(0);
      });
    });

    describe("when an existing source is updated", () => {
      it("rejects the update and leaves the stored schedule alone", async () => {
        const created = await callerFor(adminUserId).ingestionSources.create({
          organizationId,
          sourceType: "otel_generic",
          name: `bad-cron-update-${ns}`,
          pullSchedule: "*/5 * * * *",
        });

        await expect(
          callerFor(adminUserId).ingestionSources.update({
            organizationId,
            id: created.source.id,
            pullSchedule: badCron,
          }),
        ).rejects.toMatchObject({
          code: "UNPROCESSABLE_CONTENT",
          cause: { code: "validation_error" },
        });

        const persisted = await prisma.ingestionSource.findUnique({
          where: { id: created.source.id },
        });
        expect(persisted?.pullSchedule).toBe("*/5 * * * *");
      });
    });
  });

  describe("given an id this org does not have", () => {
    const missingId = `no-such-source-${ns}`;

    // The read path and the mutations must agree. The detail page decides
    // whether to render "not found" or "couldn't load" off a single check
    // (`readHandledError(error)?.httpStatus === 404`), which only works if
    // every one of these raises the same named 404.
    it("rejects the read with ingestion_source_not_found", async () => {
      await expect(
        callerFor(adminUserId).ingestionSources.get({
          organizationId,
          id: missingId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: {
          code: "ingestion_source_not_found",
          httpStatus: 404,
          meta: { id: missingId },
        },
      });
    });

    it("rejects archive with ingestion_source_not_found", async () => {
      await expect(
        callerFor(adminUserId).ingestionSources.archive({
          organizationId,
          id: missingId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { code: "ingestion_source_not_found" },
      });
    });

    it("rejects rotateSecret with ingestion_source_not_found", async () => {
      await expect(
        callerFor(adminUserId).ingestionSources.rotateSecret({
          organizationId,
          id: missingId,
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { code: "ingestion_source_not_found" },
      });
    });

    it("rejects the update with ingestion_source_not_found", async () => {
      await expect(
        callerFor(adminUserId).ingestionSources.update({
          organizationId,
          id: missingId,
          name: "renamed",
        }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { code: "ingestion_source_not_found" },
      });
    });

    it("raises the same error when the service is called directly", async () => {
      const service = app.governance;
      await expect(
        service.ingestionSourceArchive(missingId, organizationId),
      ).rejects.toMatchObject({
        code: "ingestion_source_not_found",
        httpStatus: 404,
        meta: { id: missingId },
      });
    });
  });

  describe("given a source that belongs to another org", () => {
    it("is indistinguishable from one that does not exist", async () => {
      // Cross-org probes must collapse to the same 404 as a missing row, or
      // the error itself becomes an enumeration oracle.
      const otherOrg = await prisma.organization.create({
        data: { name: `Other Org ${ns}`, slug: `--src-err-other-${ns}` },
      });
      const foreign = await prisma.ingestionSource.create({
        data: {
          organizationId: otherOrg.id,
          sourceType: "otel_generic",
          name: `foreign-${ns}`,
          ingestSecretHash: `hash-${nanoid(8)}`,
          parserConfig: {},
          status: "awaiting_first_event",
        },
      });

      try {
        await expect(
          callerFor(adminUserId).ingestionSources.get({
            organizationId,
            id: foreign.id,
          }),
        ).rejects.toMatchObject({
          code: "NOT_FOUND",
          cause: { code: "ingestion_source_not_found" },
        });
      } finally {
        await prisma.ingestionSource
          .deleteMany({ where: { organizationId: otherOrg.id } })
          .catch(() => {});
        await prisma.organization
          .deleteMany({ where: { id: otherOrg.id } })
          .catch(() => {});
      }
    });
  });
});
