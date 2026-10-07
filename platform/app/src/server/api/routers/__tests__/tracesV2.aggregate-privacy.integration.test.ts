/**
 * @vitest-environment node
 *
 * ADR-144 decision 9: an aggregate read applies the strictest privacy policy
 * across the projects its proof reads. One member captures content, the
 * other restricts it to a project owner it does not have, so no one reads it; an organisation admin reads
 * the aggregate through the real tRPC trace routes, over the real grants
 * ledger and a real ClickHouse.
 *
 * Spec: specs/governance/aggregate-project.feature, section G.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { getApp, resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AGGREGATE_PROJECT_KIND } from "~/server/app-layer/projects/project-kinds";
import { getDataPrivacyPolicyService } from "~/server/data-privacy/dataPrivacyPolicy.service";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { getUserProtectionsForProject } from "../../utils";
import {
  insertRows,
  installAggregateTraceApp,
  summaryRow,
} from "./helpers/aggregateTraceRoutes";

const run = nanoid(8);
const traceIdOf = (handle: string) => `agg-privacy-${handle}-${run}`;

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let aggregate: Project;
/** Captures content, the platform default. */
let loose: Project;
/** Restricts input and output to its owner; a team project has none. */
let strict: Project;
let admin: ReturnType<typeof appRouter.createCaller>;
/** Drops `secret.key` at ingestion. */
let dropper: Project;
/** Restricts `secret.key` to no one, so its stored value is hidden. */
let restricter: Project;
/** Reads the dropper and the restricter. */
let attributeAggregate: Project;
let window: { from: number; to: number };

const listOf = (projectId: string) =>
  admin.tracesV2.list({
    projectId,
    timeRange: window,
    sort: { columnId: "timestamp", direction: "desc" },
    page: 1,
    pageSize: 100,
  });

beforeAll(async () => {
  ch = (await startTestContainers()).clickHouseClient;
  installAggregateTraceApp({ ch });
  fixture = await seedAggregateOrganization(prisma, { label: "agg-privacy" });
  // Team projects on the admin's own team, so reading one directly shows
  // its content to the admin: a personal project's content stays with its
  // owner's team and would hide the difference this suite is about.
  loose = fixture.shared;
  strict = await fixture.makeTeamProject("strict");
  admin = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: fixture.admin.id }, expires: "1" },
    }),
  );

  await getDataPrivacyPolicyService().setForScope({
    scope: { scopeType: "PROJECT", scopeId: strict.id },
    personalOnly: false,
    config: {
      categories: {
        input: { disposition: "restrict", audience: { projectOwner: true } },
        output: { disposition: "restrict", audience: { projectOwner: true } },
      },
    },
  });

  dropper = await fixture.makeTeamProject("dropper");
  restricter = await fixture.makeTeamProject("restricter");
  await getDataPrivacyPolicyService().setForScope({
    scope: { scopeType: "PROJECT", scopeId: dropper.id },
    personalOnly: false,
    config: {
      customAttributes: [{ pattern: "secret.key", disposition: "drop" }],
    },
  });
  await getDataPrivacyPolicyService().setForScope({
    scope: { scopeType: "PROJECT", scopeId: restricter.id },
    personalOnly: false,
    config: {
      customAttributes: [
        { pattern: "secret.key", disposition: "restrict", audience: {} },
      ],
    },
  });
  const attributeView = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Attribute view ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: {
      kind: "explicit",
      projectIds: [dropper.id, restricter.id],
    },
  });
  attributeAggregate = await prisma.project.findFirstOrThrow({
    where: { slug: attributeView.projectSlug, teamId: fixture.team.id },
  });

  const { projectSlug } = await admin.project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company view ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: { kind: "explicit", projectIds: [loose.id, strict.id] },
  });
  aggregate = await prisma.project.findFirstOrThrow({
    where: { slug: projectSlug, teamId: fixture.team.id },
  });

  const occurredAt = Date.now() + 5_000;
  window = { from: occurredAt - 3_600_000, to: occurredAt + 3_600_000 };
  await insertRows({
    ch,
    table: "trace_summaries",
    values: [
      summaryRow({
        tenantId: loose.id,
        traceId: traceIdOf("loose"),
        occurredAt,
      }),
      summaryRow({
        tenantId: strict.id,
        traceId: traceIdOf("strict"),
        occurredAt,
      }),
    ],
  });
}, 180_000);

afterAll(async () => {
  try {
    if (fixture) {
      await cleanupTestRows(prisma, [
        ["dataPrivacyPolicy", { organizationId: fixture.organizationId }],
      ]);
      await fixture.cleanup();
    }
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await stopTestContainers();
  }
});

describe("Feature: an aggregate read applies the strictest member policy", () => {
  describe("given an aggregate with a loose member and a strict member", () => {
    describe("when ana reads the aggregate's trace list", () => {
      /** @scenario "The strictest member privacy policy applies" */
      it("redacts every row, the loose member's included", async () => {
        const rows = (await listOf(aggregate.id)).items.map((item) => ({
          projectId: item.projectId,
          input: item.input,
          output: item.output,
          inputRedacted: item.inputRedacted,
          outputRedacted: item.outputRedacted,
        }));

        expect(rows.map((row) => row.projectId).sort()).toEqual(
          [loose.id, strict.id].sort(),
        );
        for (const row of rows) {
          expect(row).toMatchObject({
            input: null,
            output: null,
            inputRedacted: true,
            outputRedacted: true,
          });
        }
      });
    });

    describe("when ana reads the loose member directly", () => {
      it("shows its content, so the strictness stays with the aggregate", async () => {
        const [row] = (await listOf(loose.id)).items;

        expect(row?.input).toBe(`input of ${loose.id}`);
        expect(row?.inputRedacted).toBe(false);
      });
    });

    describe("when ana opens one member's trace from the aggregate", () => {
      it("applies the aggregate's policy and that member's only", async () => {
        const looseHeader = await admin.tracesV2.header({
          projectId: aggregate.id,
          traceId: traceIdOf("loose"),
          tenantId: loose.id,
          full: false,
        });
        const strictHeader = await admin.tracesV2.header({
          projectId: aggregate.id,
          traceId: traceIdOf("strict"),
          tenantId: strict.id,
          full: false,
        });

        expect(looseHeader.input).toBe(`input of ${loose.id}`);
        expect(strictHeader.input).toBeNull();
        expect(strictHeader.inputRedacted).toBe(true);
      });
    });
  });

  describe("given an aggregate whose members drop and restrict the same attribute", () => {
    const protectionsOf = async (projectId: string) =>
      getUserProtectionsForProject(
        {
          prisma,
          session: { user: { id: fixture.admin.id }, expires: "1" },
        },
        {
          projectId,
          authorization: await getApp().authorization.authorize({
            actor: { type: "user", id: fixture.admin.id },
            principal: { type: "user", id: fixture.admin.id },
            permission: "traces:view",
            scope: { projectId },
            purpose: { kind: "route", route: "test.protections" },
          }),
        },
      );

    describe("when ana reads the restricting member directly", () => {
      it("hides the attribute", async () => {
        const protections = await protectionsOf(restricter.id);

        expect(protections.hiddenAttributes?.map((rule) => rule.pattern)).toEqual(
          ["secret.key"],
        );
      });
    });

    describe("when ana reads the aggregate", () => {
      /** @scenario "The strictest member privacy policy applies" */
      it("still hides the attribute the restricting member stored", async () => {
        const protections = await protectionsOf(attributeAggregate.id);

        expect(protections.hiddenAttributes?.map((rule) => rule.pattern)).toEqual(
          ["secret.key"],
        );
      });
    });
  });
});
