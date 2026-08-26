/**
 * The saved-chart router against a real Postgres and the real RBAC tables.
 *
 * Permissions are granted through actual `CustomRole` + `RoleBinding` rows and
 * checked by the real `checkProjectPermission`, because the claim worth making
 * is "a member who may read cannot write", and a mocked permission check can
 * only ever agree with whatever it was told to return.
 *
 * The feature-flag service is the one thing faked. It reads the environment,
 * Redis and Postgres behind a 60-second cache, and this repository's `.env`
 * force-enables the very flag under test — so consulting the real one would
 * make the switched-off case answer "on" and pass vacuously.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

const isEnabled = vi.fn();

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => isEnabled(...args),
  },
}));

/**
 * The one other fake, and it is about the harness rather than the subject.
 *
 * Resolving a member's content permissions reaches the application container
 * (`getApp()`), which no router test boots. What the protections *decide* is
 * already proven where it belongs — the service suite drives a gated column
 * through both a permitted and a withheld author — so re-deriving them here
 * would test the container, not this router.
 */
vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils")>();
  return {
    ...actual,
    getUserProtectionsForProject: vi.fn().mockResolvedValue({
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    }),
  };
});

import { VEGA_LITE_SCHEMA_URL } from "@langwatch/analytics-web/validation";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../../db";
import type { Permission } from "../../rbac";
import { createInnerTRPCContext } from "../../trpc";
import { savedWorkbenchChartsRouter } from "../analytics/savedWorkbenchCharts";

wireDefaultTestApp();

type Caller = ReturnType<typeof savedWorkbenchChartsRouter.createCaller>;

const ns = `swbc-${nanoid(8)}`;
const ORG = `org-${ns}`;
const TEAM = `team-${ns}`;
const PROJECT = `proj-${ns}`;
const OTHER_ORG = `org-other-${ns}`;
const OTHER_TEAM = `team-other-${ns}`;
const OTHER_PROJECT = `proj-other-${ns}`;

const SQL =
  "SELECT count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {since:DateTime}";

const SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { name: "query_result" },
  mark: "bar",
  encoding: { y: { field: "value", type: "quantitative" } },
};

const DEFINITION = {
  version: 1,
  sql: SQL,
  parameters: { since: "2026-02-01 00:00:00" },
  vegaLiteSpec: SPEC,
};

/** Loads its data over the network — the chart policy refuses it. */
const NETWORK_SPEC = {
  $schema: VEGA_LITE_SCHEMA_URL,
  data: { url: "https://example.invalid/rows.json" },
  mark: "bar",
};

const ALL_ANALYTICS: Permission[] = [
  "analytics:view",
  "analytics:create",
  "analytics:update",
  "analytics:delete",
];

let seq = 0;

async function seedOrg(orgId: string, teamId: string, projectId: string): Promise<void> {
  await prisma.organization.create({
    data: { id: orgId, name: orgId, slug: orgId },
  });
  await prisma.team.create({
    data: { id: teamId, name: teamId, slug: teamId, organizationId: orgId },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: projectId,
      slug: projectId,
      teamId,
      language: "en",
      framework: "openai",
      apiKey: `key-${projectId}`,
    },
  });
}

/**
 * An org MEMBER whose only grant is an explicit custom role, so a pass can only
 * come from the permission under test rather than from an admin short-circuit.
 */
async function seedCaller(orgId: string, perms: Permission[]): Promise<Caller> {
  const uid = `usr-${ns}-${seq++}`;
  const email = `${uid}@example.com`;
  await prisma.user.create({ data: { id: uid, email, name: uid } });
  await prisma.organizationUser.create({
    data: {
      organizationId: orgId,
      userId: uid,
      role: OrganizationUserRole.MEMBER,
    },
  });
  const roleId = `crole-${uid}`;
  await prisma.customRole.create({
    data: {
      id: roleId,
      organizationId: orgId,
      name: roleId,
      permissions: perms,
    },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: orgId,
      userId: uid,
      role: TeamUserRole.CUSTOM,
      customRoleId: roleId,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: orgId,
    },
  });
  return savedWorkbenchChartsRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: uid, email, name: uid },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      } as any,
    }),
  );
}

/** The refusal an awaited call produced, or a failure if it produced none. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code ?? "unknown";
  }
  throw new Error("expected a refusal, but the call succeeded");
}

describe("the saved workbench chart router", () => {
  let author: Caller;
  let reader: Caller;
  let stranger: Caller;

  beforeAll(async () => {
    await seedOrg(ORG, TEAM, PROJECT);
    await seedOrg(OTHER_ORG, OTHER_TEAM, OTHER_PROJECT);
    author = await seedCaller(ORG, ALL_ANALYTICS);
    reader = await seedCaller(ORG, ["analytics:view"]);
    stranger = await seedCaller(OTHER_ORG, ALL_ANALYTICS);
  }, 60_000);

  /**
   * Raw deletes, in dependency order.
   *
   * `prisma.project.delete()` would emulate a referential action against every
   * relation the schema declares, and this repository's shared development
   * database is missing tables newer than its last migration — so the tidy-up
   * would fail on a table this suite never touched. Naming the rows it actually
   * created keeps cleanup a function of what the suite did.
   */
  afterAll(async () => {
    const ids = (values: string[]) => values.map((value) => `'${value}'`).join(",");
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CustomGraph" WHERE "projectId" IN (${ids([PROJECT, OTHER_PROJECT])})`,
    );
    await prisma.$executeRawUnsafe(
      `-- @tenancy: deleting this suite's own Project rows by their exact ids
      DELETE FROM "Project" WHERE id IN (${ids([PROJECT, OTHER_PROJECT])})`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "RoleBinding" WHERE "organizationId" IN (${ids([ORG, OTHER_ORG])})`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CustomRole" WHERE "organizationId" IN (${ids([ORG, OTHER_ORG])})`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "OrganizationUser" WHERE "organizationId" IN (${ids([ORG, OTHER_ORG])})`,
    );
    await prisma.$executeRawUnsafe(
      `-- @tenancy: deleting this suite's own User rows by its unique namespace prefix
      DELETE FROM "User" WHERE id LIKE 'usr-${ns}%'`,
    );
    await prisma.$executeRawUnsafe(
      `-- @tenancy: deleting this suite's own Team rows by their exact ids
      DELETE FROM "Team" WHERE id IN (${ids([TEAM, OTHER_TEAM])})`,
    );
    await prisma.$executeRawUnsafe(
      `-- @tenancy: deleting this suite's own Organization rows by their exact ids
      DELETE FROM "Organization" WHERE id IN (${ids([ORG, OTHER_ORG])})`,
    );
  });

  beforeEach(async () => {
    isEnabled.mockReset();
    isEnabled.mockResolvedValue(true);
    await prisma.customGraph.deleteMany({ where: { projectId: PROJECT } });
    await prisma.customGraph.deleteMany({
      where: { projectId: OTHER_PROJECT },
    });
  });

  const saveChart = (name = "Traces per day") =>
    author.create({ projectId: PROJECT, name, definition: DEFINITION });

  describe("given the workbench switch is off for the project", () => {
    describe("when the member reaches any of the procedures", () => {
      /** @scenario "Saved charts stay unreachable while the workbench switch is off" */
      it("refuses every one of them the same way", async () => {
        const saved = await saveChart();
        isEnabled.mockResolvedValue(false);

        expect(await refusalOf(() => author.getAll({ projectId: PROJECT }))).toBe(
          "lwql_not_enabled",
        );
        expect(
          await refusalOf(() => author.getById({ projectId: PROJECT, id: saved.id })),
        ).toBe("lwql_not_enabled");
        expect(await refusalOf(() => saveChart("Another"))).toBe("lwql_not_enabled");
        expect(
          await refusalOf(() =>
            author.update({
              projectId: PROJECT,
              id: saved.id,
              name: "Renamed",
            }),
          ),
        ).toBe("lwql_not_enabled");
        expect(
          await refusalOf(() => author.delete({ projectId: PROJECT, id: saved.id })),
        ).toBe("lwql_not_enabled");
      });
    });
  });

  describe("given a member who may view analytics but not change them", () => {
    describe("when they list charts and then try to write", () => {
      /** @scenario "Being allowed to read a chart is not being allowed to change one" */
      it("lets the listing through and refuses each write for want of its own permission", async () => {
        const saved = await saveChart();

        // The read they are entitled to.
        expect((await reader.getAll({ projectId: PROJECT })).map(({ id }) => id)).toEqual(
          [saved.id],
        );

        // Each write, refused on its own permission rather than on the read one.
        expect(
          await refusalOf(() =>
            reader.create({
              projectId: PROJECT,
              name: "Theirs",
              definition: DEFINITION,
            }),
          ),
        ).toBe("permission_denied");
        expect(
          await refusalOf(() =>
            reader.update({
              projectId: PROJECT,
              id: saved.id,
              name: "Renamed",
            }),
          ),
        ).toBe("permission_denied");
        expect(
          await refusalOf(() => reader.delete({ projectId: PROJECT, id: saved.id })),
        ).toBe("permission_denied");

        // Nothing the refused writes attempted actually happened.
        const after = await author.getById({
          projectId: PROJECT,
          id: saved.id,
        });
        expect(after.name).toBe("Traces per day");
        expect((await author.getAll({ projectId: PROJECT })).length).toBe(1);
      });
    });
  });

  describe("given a member of another organization", () => {
    describe("when they reach for this project's charts", () => {
      /** @scenario "Reading saved charts requires the analytics permission" */
      it("is refused before any chart is read", async () => {
        await saveChart();

        await expect(stranger.getAll({ projectId: PROJECT })).rejects.toThrow();
      });
    });
  });

  describe("given a chart saved in another project", () => {
    describe("when the member names its id on their own project", () => {
      /** @scenario "Every procedure answers only for the project in the request" */
      it("answers not found, exactly as for an id that never existed", async () => {
        const theirs = await stranger.create({
          projectId: OTHER_PROJECT,
          name: "Theirs",
          definition: DEFINITION,
        });

        expect(
          await refusalOf(() => author.getById({ projectId: PROJECT, id: theirs.id })),
        ).toBe("saved_workbench_chart_not_found");
        expect(
          await refusalOf(() =>
            author.getById({ projectId: PROJECT, id: `never-${nanoid()}` }),
          ),
        ).toBe("saved_workbench_chart_not_found");
        expect(
          await refusalOf(() =>
            author.update({
              projectId: PROJECT,
              id: theirs.id,
              name: "Mine now",
            }),
          ),
        ).toBe("saved_workbench_chart_not_found");
        expect(
          await refusalOf(() => author.delete({ projectId: PROJECT, id: theirs.id })),
        ).toBe("saved_workbench_chart_not_found");

        // Still theirs, still named what they named it.
        expect(
          (
            await stranger.getById({
              projectId: OTHER_PROJECT,
              id: theirs.id,
            })
          ).name,
        ).toBe("Theirs");
      });
    });
  });

  describe("given a definition the governors refuse", () => {
    describe("when the member saves it through the application", () => {
      /** @scenario "A refusal from the write gate reaches the member with its code intact" */
      it("delivers the service's own code rather than a generic failure", async () => {
        expect(
          await refusalOf(() =>
            author.create({
              projectId: PROJECT,
              name: "Loads over the network",
              definition: { ...DEFINITION, vegaLiteSpec: NETWORK_SPEC },
            }),
          ),
        ).toBe("saved_workbench_chart_specification_refused");

        expect(
          await refusalOf(() =>
            author.create({
              projectId: PROJECT,
              name: "A write dressed as a chart",
              definition: { ...DEFINITION, sql: "DROP TABLE analytics.traces" },
            }),
          ),
        ).toBe("lwql_not_permitted");

        expect(
          await refusalOf(() =>
            author.create({
              projectId: PROJECT,
              name: "Shapeless",
              definition: { sql: SQL },
            }),
          ),
        ).toBe("validation_error");

        expect((await author.getAll({ projectId: PROJECT })).length).toBe(0);
      });
    });
  });

  describe("given a member saving and then editing a chart", () => {
    describe("when they save, read, rename and delete it", () => {
      /** @scenario "A saved chart can be renamed or deleted from the list" */
      it("keeps the definition through a rename and removes it on delete", async () => {
        const first = await saveChart("First");
        const second = await saveChart("Second");

        const renamed = await author.update({
          projectId: PROJECT,
          id: first.id,
          name: "First, renamed",
        });
        expect(renamed.name).toBe("First, renamed");
        expect(renamed.definition.sql).toBe(SQL);
        expect(renamed.definition.vegaLiteSpec).toEqual(SPEC);

        await author.delete({ projectId: PROJECT, id: second.id });

        const remaining = await author.getAll({ projectId: PROJECT });
        expect(remaining.map(({ id }) => id)).toEqual([first.id]);
      });
    });
  });
});
