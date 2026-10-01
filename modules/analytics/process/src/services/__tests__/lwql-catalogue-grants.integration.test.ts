/**
 * A caller reads only what their grants unlock: protections resolved through the real resolver
 * over an authz double, then the real validator and schema over the shipped catalogue.
 * @see specs/lwql/catalogue-grants.feature
 */
import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzPermission } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { LWQL_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { WorkbenchProtectionsService } from "../workbench-protections.service.ts";
import {
  authzGranting,
  EVERY_CATALOGUE_PERMISSION,
  type AuthzCheck,
} from "./lwql-catalogue-access.fixture.ts";

const PROJECT_ID = "project-1";
const lwql = LangWatchQLService.create({ executor: null, database: "analytics" });

function protectionsService({
  authz,
  policy = () => Promise.resolve(PLATFORM_DEFAULT_DATA_PRIVACY),
}: {
  authz: AuthzApi;
  policy?: () => Promise<ResolvedDataPrivacy>;
}): WorkbenchProtectionsService {
  return WorkbenchProtectionsService.create({
    authz,
    dataPrivacy: createApiFixture<DataPrivacyApi>({ getResolvedForProject: policy }),
    projects: createApiFixture<ProjectApi>(),
  });
}

/** A member holding every catalogue permission at the project but those withheld. */
function memberWithout(...withheld: readonly string[]): Promise<LangWatchQLProtections> {
  const grants = (check: AuthzCheck) =>
    check.scope.type !== "organization" && !withheld.includes(check.permission);
  return protectionsService({ authz: authzGranting({ grants }).authz }).resolveMemberProtections({
    userId: "user-1",
    projectId: PROJECT_ID,
  });
}

function refusal(protections: LangWatchQLProtections, sql: string) {
  try {
    lwql.validate({ projectId: PROJECT_ID, protections, sql });
  } catch (error) {
    return error;
  }
  throw new Error(`expected "${sql}" to be refused`);
}

const accepts = (protections: LangWatchQLProtections, sql: string) =>
  expect(() => lwql.validate({ projectId: PROJECT_ID, protections, sql })).not.toThrow();

const schemaViews = (protections: LangWatchQLProtections) =>
  lwql.describeSchema({ protections }).views.map((view) => view.name);

describe("given a member holding analytics:view but not virtualKeys:view", () => {
  /** @scenario "A member without a table's permission is refused by name" */
  it("refuses the table by name and leaves it out of availableViews", async () => {
    const protections = await memberWithout("virtualKeys:view");

    expect(refusal(protections, "SELECT * FROM analytics.virtual_keys")).toMatchObject({
      code: "lwql_not_permitted",
      meta: {
        violations: expect.arrayContaining([
          expect.objectContaining({ code: "TABLE_NOT_ALLOWED" }),
        ]),
      },
    });
    const violations = (
      refusal(protections, "SELECT * FROM analytics.virtual_keys") as {
        meta: { violations: { availableViews?: readonly string[] }[] };
      }
    ).meta.violations;
    expect(violations.flatMap((violation) => violation.availableViews ?? [])).not.toContain(
      "analytics.virtual_keys",
    );
  });

  /** @scenario "The schema omits a table the caller cannot read" */
  it("omits the table from the schema", async () => {
    const protections = await memberWithout("virtualKeys:view");

    expect(schemaViews(protections)).not.toContain("analytics.virtual_keys");
    expect(schemaViews({ ...protections, catalogue: EVERY_CATALOGUE_PERMISSION })).toContain(
      "analytics.virtual_keys",
    );
  });
});

describe("given one table of allOf access and another of anyOf", () => {
  /** @scenario "allOf needs every permission; anyOf needs one" */
  it("refuses the allOf table and admits the anyOf table to a holder of the first of each", () => {
    const either: readonly [AuthzPermission, AuthzPermission] = [
      "analytics:view",
      "virtualKeys:view",
    ];
    const service = LangWatchQLService.create({
      executor: null,
      database: "analytics",
      catalog: {
        ...LWQL_CATALOG,
        virtual_keys: { ...LWQL_CATALOG.virtual_keys, access: { allOf: either } },
        prompts: { ...LWQL_CATALOG.prompts, access: { anyOf: either } },
      },
    });
    const protections: LangWatchQLProtections = { catalogue: { permissions: ["analytics:view"] } };
    const validate = (sql: string) => () =>
      service.validate({ projectId: PROJECT_ID, protections, sql });

    expect(validate("SELECT count() FROM analytics.virtual_keys")).toThrow(
      expect.objectContaining({ code: "lwql_not_permitted" }),
    );
    expect(validate("SELECT count() FROM analytics.prompts")).not.toThrow();
  });
});

describe("given a member holding governanceCost:view at their organization", () => {
  /** @scenario "An organization-tier permission is asked at the organization" */
  it("admits the organization-tier table in one of its projects", async () => {
    const grants = (check: AuthzCheck) =>
      check.scope.type === "organization"
        ? check.permission === "governanceCost:view" && check.scope.id === "org-1"
        : check.permission === "analytics:view";
    const protections = await protectionsService({
      authz: authzGranting({ grants }).authz,
    }).resolveMemberProtections({ userId: "user-1", projectId: PROJECT_ID });
    expect(() =>
      lwql.validate({
        projectId: PROJECT_ID,
        protections,
        sql: "SELECT count() FROM analytics.governance_hourly_kpis",
      }),
    ).not.toThrow();
  });
});

describe("given a key granted virtualKeys:view whose owner lost it", () => {
  /** @scenario "An API key is bounded by its own grants and its owner's" */
  it("refuses the table, because authz answers the key under its owner's ceiling", async () => {
    // What authz answers once the ceiling applies: the key's grant, less what its owner lost.
    const grants = (check: AuthzCheck) =>
      check.principal.type === "apiKey" && check.permission !== "virtualKeys:view";
    const protections = await protectionsService({
      authz: authzGranting({ grants }).authz,
    }).resolveApiKeyProtections({
      projectId: PROJECT_ID,
      credential: {
        kind: "apiKey",
        apiKeyId: "key-1",
        userId: "owner-1",
        organizationId: "org-1",
        projectId: PROJECT_ID,
        teamId: "team-1",
      },
    });

    expect(refusal(protections, "SELECT count() FROM analytics.virtual_keys")).toMatchObject({
      code: "lwql_not_permitted",
    });
  });
});

describe("given a member without cost:view", () => {
  /** @scenario "A cost column without cost:view is listed unavailable and refused" */
  it("lists the cost column unavailable with its gate and refuses it at its position", async () => {
    const protections = await memberWithout("cost:view");

    const traces = lwql
      .describeSchema({ protections })
      .views.find((view) => view.name === "analytics.traces");
    expect(traces?.columns.find((column) => column.name === "TotalCost")).toMatchObject({
      available: false,
      gates: expect.arrayContaining(["cost:view"]),
    });
    expect(refusal(protections, "SELECT TotalCost FROM analytics.traces")).toMatchObject({
      meta: {
        violations: expect.arrayContaining([
          expect.objectContaining({ code: "GATED_COLUMN", at: { line: 1, column: 8 } }),
        ]),
      },
    });
  });
});

describe("given a policy that hides captured input from the member", () => {
  /** @scenario "A content column follows the project's data-privacy policy" */
  it("refuses CapturedInput at its position and admits CapturedOutput", async () => {
    const adminsOnly = {
      disposition: "restrict",
      audience: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input.audience, admins: true },
    } as const;
    const protections = await protectionsService({
      authz: authzGranting({ grants: (check) => check.permission !== "project:update" }).authz,
      policy: () =>
        Promise.resolve({
          ...PLATFORM_DEFAULT_DATA_PRIVACY,
          categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories, input: adminsOnly },
        }),
    }).resolveMemberProtections({ userId: "user-1", projectId: PROJECT_ID });

    expect(refusal(protections, "SELECT CapturedInput FROM analytics.traces")).toMatchObject({
      meta: {
        violations: expect.arrayContaining([
          expect.objectContaining({ code: "GATED_COLUMN", at: { line: 1, column: 8 } }),
        ]),
      },
    });
    accepts(protections, "SELECT CapturedOutput FROM analytics.traces");
  });
});

describe("when the authz check throws", () => {
  /** @scenario "A permission check that throws refuses rather than widening" */
  it("fails the resolution with the unhandled error, so no statement runs", async () => {
    const unreachable = () => Promise.reject(new Error("grants head unreachable"));
    const { authz } = authzGranting({
      grants: () => true,
      overrides: { can: unreachable, canBatchPermissionsByIds: unreachable },
    });

    const resolving = protectionsService({ authz }).resolveMemberProtections({
      userId: "user-1",
      projectId: PROJECT_ID,
    });

    await expect(resolving).rejects.toThrow("grants head unreachable");
    await expect(resolving).rejects.not.toHaveProperty("code");
  });
});

describe("given a data-privacy policy that cannot be read", () => {
  /** @scenario "A data-privacy failure hides content only" */
  it("lists the content columns unavailable and admits every other traces column", async () => {
    const protections = await protectionsService({
      authz: authzGranting({ grants: () => true }).authz,
      policy: () => Promise.reject(new Error("policy store away")),
    }).resolveMemberProtections({ userId: "user-1", projectId: PROJECT_ID });

    const columns =
      lwql.describeSchema({ protections }).views.find((view) => view.name === "analytics.traces")
        ?.columns ?? [];
    const unavailable = columns.filter((column) => !column.available).map((column) => column.name);
    expect(unavailable).toEqual(expect.arrayContaining(["CapturedInput", "CapturedOutput"]));
    expect(
      unavailable.every((name) =>
        columns
          .find((column) => column.name === name)
          ?.gates.some((gate) => gate === "input" || gate === "output"),
      ),
    ).toBe(true);
    accepts(protections, "SELECT TraceId, TotalCost FROM analytics.traces");
  });
});
