/**
 * @vitest-environment node
 *
 * ADR-144 decision 7: every "send traces here" picker hides the aggregate,
 * and every path that would hand out or accept it as a destination refuses
 * it. Driven as an organisation admin, the one person who sees the aggregate
 * in the switcher at all, so its absence below is the picker's doing.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { HandledError } from "@langwatch/handled-error";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { virtualKeyProjectOptions } from "~/components/gateway/virtualKeyProjectOptions";
import type { Project } from "~/generated/prisma/client";
import { resolveCliAuthProjects } from "~/pages/cli/cliAuthProjects";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { ApiKeyRepository } from "~/server/api-key/api-key.repository";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { startTestContainers } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { decideTraceDestination } from "~/server/gateway/scopeResolver";
import { assertTraceProjectBelongsToOrg } from "~/server/gateway/virtualKey.authz";
import { app as authCliApp } from "~/server/routes/auth-cli";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const ACCESS_TOKEN = `lw_at_${"g".repeat(43)}-agg-${nanoid(8)}`;

describe("Feature: the aggregate project is no place to send traces", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;
  let redis: Redis | null = null;

  const adminTeams = async () => {
    const organizations = await appRouter
      .createCaller(
        createInnerTRPCContext({
          session: { user: { id: fixture.admin.id }, expires: "1" },
        }),
      )
      .organization.getAll({});
    return organizations
      .filter((organization) => organization.id === fixture.organizationId)
      .flatMap((organization) => organization.teams);
  };

  const cliRequest = (path: string, body: Record<string, unknown>) =>
    authCliApp.request(`/api/auth/cli${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    ({ redisConnection: redis } = await startTestContainers());
    globalForApp.__langwatch_app = createTestApp({
      redis,
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-pickers" });
    aggregate = await fixture.makeAggregate("company-view");
    if (!redis) throw new Error("Redis unavailable in test env");
    await redis.set(
      `lwcli:access:${ACCESS_TOKEN}`,
      JSON.stringify({
        user_id: fixture.admin.id,
        organization_id: fixture.organizationId,
        issued_at: Date.now(),
        expires_at: Date.now() + 60 * 60 * 1000,
      }),
      "EX",
      60 * 60,
    );
  }, 60_000);

  afterAll(async () => {
    await redis?.del(`lwcli:access:${ACCESS_TOKEN}`);
    await resetApp();
    await fixture?.cleanup();
  });

  /** @scenario "The aggregate project is absent from every send-traces-here picker" */
  describe("given an aggregate project the admin can see in the switcher", () => {
    it("is in the admin's switcher, so its absence below is the pickers' doing", async () => {
      const ids = (await adminTeams()).flatMap((team) =>
        team.projects.map((project) => project.id),
      );

      expect(ids).toContain(aggregate.id);
      expect(ids).toContain(fixture.shared.id);
    });

    describe("when the CLI lists projects to log in to", () => {
      it("leaves the aggregate out", async () => {
        const { projects } = resolveCliAuthProjects({
          teams: await adminTeams(),
          currentUserId: fixture.admin.id,
        });

        expect(projects.map((project) => project.id)).toContain(
          fixture.shared.id,
        );
        expect(projects.map((project) => project.id)).not.toContain(
          aggregate.id,
        );
      });

      it("refuses to hand out the aggregate's key when it is named anyway", async () => {
        const response = await cliRequest("/project-key", {
          slug: aggregate.slug,
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: "aggregate_project_has_no_credential",
        });
      });
    });

    describe("when the CLI mints an ingestion key for a named project", () => {
      it("refuses the aggregate and mints nothing", async () => {
        const response = await cliRequest("/governance/ingestion-key", {
          project: aggregate.id,
          source_type: "claude_code",
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: "aggregate_project_has_no_credential",
        });
        expect(
          await prisma.apiKey.count({
            where: {
              organizationId: fixture.organizationId,
              roleBindings: {
                some: { scopeType: "PROJECT", scopeId: aggregate.id },
              },
            },
          }),
        ).toBe(0);
      });
    });

    describe("when an API key's project scopes are listed", () => {
      it("leaves the aggregate out", async () => {
        const projects = await ApiKeyRepository.create(
          prisma,
        ).findProjectsInOrg({ organizationId: fixture.organizationId });

        expect(projects.map((project) => project.id)).toContain(
          fixture.shared.id,
        );
        expect(projects.map((project) => project.id)).not.toContain(
          aggregate.id,
        );
      });
    });

    describe("when a virtual key's destination is picked", () => {
      it("leaves the aggregate out of the picker", async () => {
        const options = virtualKeyProjectOptions(await adminTeams());

        expect(options.map((option) => option.id)).toContain(fixture.shared.id);
        expect(options.map((option) => option.id)).not.toContain(aggregate.id);
      });

      it("refuses the aggregate when a key names it anyway", async () => {
        const refusal = await assertTraceProjectBelongsToOrg(
          prisma,
          fixture.organizationId,
          aggregate.id,
        )
          .then(() => null)
          .catch((error: unknown) => error);

        expect(HandledError.isHandled(refusal)).toBe(true);
        expect((refusal as HandledError).code).toBe(
          "gateway_trace_project_not_a_destination",
        );
      });

      it("never resolves a key's traces to the aggregate", async () => {
        const decision = await decideTraceDestination(prisma, {
          organizationId: fixture.organizationId,
          traceProjectId: aggregate.id,
          scopes: [],
        });

        expect(decision.outcome).not.toBe("resolved");
      });
    });
  });
});
