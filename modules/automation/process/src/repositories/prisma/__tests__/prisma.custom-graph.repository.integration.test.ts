/**
 * @vitest-environment node
 * Automation's graph reads against Postgres, behind the tenancy guard every process composes:
 * a graph on an Only me board answers as one that is not there. Needs a test database at
 * `LANGWATCH_TEST_DATABASE_URL`. Spec: modules/dashboard/specs/dashboards-v2.feature AC187.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaCustomGraphRepository } from "../prisma.custom-graph.repository.ts";
import { PrismaGraphTriggerSentRepository } from "../prisma.graph-trigger-sent.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("automation-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given builder graphs on boards of each scope", () => {
  const namespace = `automation-graphs-${randomUUID()}`;
  const graphId = (name: string) => `${namespace}-${name}`;
  let organizationId = "";
  let projectId = "";
  let onlyMeBoardId = "";
  let projectBoardId = "";

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = await database().project.create({
      data: {
        name: namespace,
        slug: namespace,
        apiKey: namespace,
        teamId: team.id,
        language: "typescript",
        framework: "other",
      },
      select: { id: true },
    });
    projectId = project.id;
    const board = (name: string, scope: "PRIVATE" | "PROJECT") =>
      database().dashboard.create({
        data: { projectId, name, scope, createdById: "author" },
        select: { id: true },
      });
    onlyMeBoardId = (await board("Mine", "PRIVATE")).id;
    projectBoardId = (await board("Ours", "PROJECT")).id;
    const graph = (name: string, dashboardId: string | null) =>
      database().customGraph.create({
        data: {
          id: graphId(name),
          projectId,
          name,
          dashboardId,
          graph: { series: [{ metric: "metadata.trace_id" }] },
        },
      });
    await graph("only-me", onlyMeBoardId);
    await graph("project", projectBoardId);
    await graph("unplaced", null);
  });

  afterAll(async () => {
    await cleanupTestRows(database(), [
      ["customGraph", { projectId }],
      ["dashboard", { projectId }],
      ["project", { id: projectId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
  });

  const graphs = () => PrismaCustomGraphRepository.create(database());
  const ask = (name: string) => ({ customGraphId: graphId(name), projectId });

  /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
  it("reads a graph on an Only me board as it reads an id the project does not have", async () => {
    const read = async (name: string) => ({
      row: (await graphs().findById(ask(name)))?.name ?? null,
      exists: await graphs().existsInProject(ask(name)),
      source: await PrismaGraphTriggerSentRepository.create(database()).findGraphTriggerSource({
        ...ask(name),
        triggerId: "trigger-1",
        seriesName: "0/metadata.trace_id/cardinality",
      }),
    });
    const found = (name: string) => ({ row: name, exists: true, source: "trace" });

    expect({
      onlyMe: await read("only-me"),
      project: await read("project"),
      unplaced: await read("unplaced"),
    }).toEqual({
      onlyMe: await read("no-such-graph"),
      project: found("project"),
      unplaced: found("unplaced"),
    });
  });

  /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
  it("lists no panel of an Only me board, and names no graph on one", async () => {
    const panels = async (dashboardId: string) =>
      (await graphs().findAllByDashboardId({ dashboardId, projectId })).map(({ name }) => name);
    const names = await graphs().findAllNamesByIds({
      customGraphIds: ["only-me", "project", "unplaced"].map(graphId),
      projectId,
    });

    expect({
      onlyMe: await panels(onlyMeBoardId),
      project: await panels(projectBoardId),
      names: names.map(({ name }) => name).toSorted(),
    }).toEqual({ onlyMe: [], project: ["project"], names: ["project", "unplaced"] });
  });

  /** @scenario "AC187 Scope: an alert or a scheduled report reads nothing from an Only me board" */
  it("reads the graphs again once the author sets the board to Project", async () => {
    await database().dashboard.update({
      where: { id: onlyMeBoardId, projectId },
      data: { scope: "PROJECT" },
    });

    expect(await graphs().existsInProject(ask("only-me"))).toBe(true);
  });
});
