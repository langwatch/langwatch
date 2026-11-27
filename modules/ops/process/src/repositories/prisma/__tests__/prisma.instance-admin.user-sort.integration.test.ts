/**
 * @vitest-environment node
 * The Back office users list is ordered in SQL across the whole search before it is paged.
 * @see modules/ops/specs/admin-user-sort.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import type { AdminUserSortField } from "@langwatch/ops-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaInstanceAdminRepository } from "../prisma.instance-admin.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaInstanceAdminRepository users list order", () => {
  const run = randomUUID().slice(0, 8);
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:ops:test:admin-user-sort"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  const id = (key: string) => `sort_${key}_${run}`;
  const ids = (keys: string) => keys.split("").map(id);
  // a: active, 2 orgs, 3 projects. b: unverified, 1 org, 1 project. c: pending SSO, no org.
  // d: deactivated though verified, no name, 1 org, 2 projects. e: unverified, a cleared
  // (empty) name, no org. Only b has logged in.
  const users = [
    { id: id("a"), name: `Ada ${run}`, email: `ada-${run}@example.com`, emailVerified: true },
    { id: id("b"), name: `bob ${run}`, email: `bob-${run}@example.com` },
    { id: id("c"), name: `Cy ${run}`, email: `cy-${run}@example.com`, pendingSsoSetup: true },
    {
      id: id("d"),
      name: null,
      email: `dee-${run}@example.com`,
      emailVerified: true,
      deactivatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    { id: id("e"), name: "", email: `eve-${run}@example.com` },
  ];
  const userIds = users.map((user) => user.id);
  const orgs = [id("org1"), id("org2")];
  const teams = [id("team1"), id("team2")];
  // p4 is archived, so it never counts.
  const projects = [
    { id: id("p1"), team: 0, archivedAt: null },
    { id: id("p2"), team: 0, archivedAt: null },
    { id: id("p3"), team: 1, archivedAt: null },
    { id: id("p4"), team: 1, archivedAt: new Date() },
  ];

  beforeAll(async () => {
    await prisma.user.createMany({
      data: users.map((user, index) => ({
        ...user,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
        lastLoginAt: index === 1 ? new Date("2026-06-01T00:00:00Z") : null,
      })),
    });
    await prisma.organization.createMany({
      data: orgs.map((org) => ({ id: org, name: org, slug: `--test-${org}` })),
    });
    await prisma.team.createMany({
      data: teams.map((team, index) => ({
        id: team,
        name: team,
        slug: `--test-${team}`,
        organizationId: orgs[index]!,
      })),
    });
    for (const project of projects) {
      await prisma.project.create({
        data: {
          id: project.id,
          name: project.id,
          slug: `--test-${project.id}`,
          apiKey: `sk-test-${project.id}`,
          teamId: teams[project.team]!,
          language: "python",
          framework: "openai",
          archivedAt: project.archivedAt,
        },
      });
    }
    await prisma.organizationUser.createMany({
      data: [
        { userId: id("a"), organizationId: orgs[0]!, role: "MEMBER" },
        { userId: id("a"), organizationId: orgs[1]!, role: "MEMBER" },
        { userId: id("b"), organizationId: orgs[1]!, role: "MEMBER" },
        { userId: id("d"), organizationId: orgs[0]!, role: "MEMBER" },
      ],
    });
  });

  afterAll(async () => {
    for (const organizationId of orgs) {
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
    }
    for (const project of projects) {
      await prisma.project.delete({ where: { id: project.id } });
    }
    await prisma.team.deleteMany({ where: { id: { in: teams } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function list({
    field,
    order,
    query = run,
    page = 1,
    perPage = 25,
  }: {
    field: AdminUserSortField;
    order: "ASC" | "DESC";
    query?: string;
    page?: number;
    perPage?: number;
  }) {
    const result = await PrismaInstanceAdminRepository.create(prisma).execute({
      method: "getList",
      resource: "user",
      params: { filter: { query }, sort: { field, order }, pagination: { page, perPage } },
      actorId: "operator_1",
      req: { headers: {} },
    });
    if (!("total" in result)) throw new Error("a list answers rows and a total");
    return {
      total: result.total,
      ids: (result.data as { id: string }[]).map((row) => row.id),
    };
  }

  /** @scenario "The users list is ordered across every page before it is paged" */
  it("orders every column in both directions, nulls last, before paging", async () => {
    const expected: Record<AdminUserSortField, { ASC: string; DESC: string }> = {
      id: { ASC: "abcde", DESC: "edcba" },
      name: { ASC: "abcde", DESC: "cbaed" },
      email: { ASC: "abcde", DESC: "edcba" },
      createdAt: { ASC: "abcde", DESC: "edcba" },
      lastLoginAt: { ASC: "bacde", DESC: "bedca" },
      organizations: { ASC: "cebda", DESC: "adbec" },
      projects: { ASC: "cebda", DESC: "adbec" },
      status: { ASC: "abecd", DESC: "dceba" },
    };
    for (const [field, orders] of Object.entries(expected) as [
      AdminUserSortField,
      { ASC: string; DESC: string },
    ][]) {
      expect((await list({ field, order: "ASC" })).ids, `${field} ASC`).toEqual(ids(orders.ASC));
      expect((await list({ field, order: "DESC" })).ids, `${field} DESC`).toEqual(ids(orders.DESC));
    }

    const first = await list({ field: "projects", order: "DESC", page: 1, perPage: 2 });
    const second = await list({ field: "projects", order: "DESC", page: 2, perPage: 2 });
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
    expect([...first.ids, ...second.ids]).toEqual(ids("adbe"));

    // A search on an organization's name narrows to its members and keeps the order.
    const searched = await list({ field: "projects", order: "DESC", query: orgs[0]! });
    expect(searched).toEqual({ total: 2, ids: ids("ad") });
  });
});
