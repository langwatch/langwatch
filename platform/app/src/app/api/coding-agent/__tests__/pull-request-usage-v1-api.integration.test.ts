/**
 * @vitest-environment node
 * @integration
 *
 * The v1 organization-key door on the pull-request usage rollup:
 * `GET /api/v1/coding-agent/pull-request-usage`. An organization API key
 * answers with the caller's organization-wide rollup and names no project
 * anywhere in the request. A user-bound key's answer is cut by BOTH halves of
 * the credential — the holder's own permissions and the key's binding ceiling
 * — so a deliberately narrowed key reads with its own scope, never its
 * holder's. A service key, which owns no user, reads with its bindings alone
 * and is audited as the key identity.
 *
 * The refusal cases live in pull-request-usage-v1-refusals.integration.test.ts;
 * the shared fixture in pullRequestUsageV1Harness.ts.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import publishedSpec from "../../openapiLangWatch.json";
import { app } from "../[[...route]]/app.v1";
import {
  bearer,
  cleanupPullRequestUsageV1Fixture,
  type PullRequestUsageV1Fixture,
  seedPullRequestUsageV1Fixture,
  USAGE_PATH,
  USAGE_SPEC_PATH,
} from "./pullRequestUsageV1Harness";
import { installPullRequestUsageTestApp } from "./pullRequestUsageV1TestApp";

const ns = nanoid(8);

let fixture: PullRequestUsageV1Fixture;

beforeAll(async () => {
  fixture = await seedPullRequestUsageV1Fixture({ ns });
  installPullRequestUsageTestApp(fixture);
});

afterAll(async () => {
  await resetApp();
  await cleanupPullRequestUsageV1Fixture(fixture);
});

/** The latest audit row this suite's organization recorded. */
const latestAuditRow = () =>
  prisma.auditLog.findFirst({
    where: {
      organizationId: fixture.organization.id,
      action: "codingAgents.pullRequestUsage",
    },
    orderBy: { createdAt: "desc" },
  });

describe("Feature: Pull request usage v1 REST API", () => {
  describe("given a user-bound organization API key", () => {
    describe("when the usage is read with no project id anywhere", () => {
      /** @scenario "An organization key reads pull request usage without naming a project" */
      it("answers the caller's organization-wide rollup and records the read", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.callerToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.pullRequest.repositoryFullName).toBe("acme/widgets");
        expect(
          body.rows.map((row: { projectId: string }) => row.projectId).sort(),
        ).toEqual([fixture.projectAId, fixture.projectBId].sort());
        expect(body.totals.sessionsCount).toBe(2);

        const recorded = await latestAuditRow();
        expect(recorded?.userId).toBe(fixture.callerUserId);
        expect(recorded?.targetKind).toBe("pullRequest");
        expect(recorded?.targetId).toBe("github.com/acme/widgets#1");
        expect(recorded?.args).toMatchObject({
          repository: "acme/widgets",
          pullRequest: 1,
          contributingProjectCount: 2,
        });
      });
    });
  });

  describe("given the same holder's key bound to one project alone", () => {
    describe("when the usage is read with the narrowed key", () => {
      /** @scenario "A narrowed key reads with its own scope, not its holder's" */
      it("answers only the bound project, though the holder may view both", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.narrowedToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(
          body.rows.map((row: { projectId: string }) => row.projectId),
        ).toEqual([fixture.projectAId]);
        // The excluded project appears nowhere in the whole answer: not as a
        // row, not in a label, not in a slug.
        expect(JSON.stringify(body)).not.toContain(fixture.projectBId);
        expect((await latestAuditRow())?.args).toMatchObject({
          contributingProjectCount: 1,
        });
      });
    });
  });

  describe("given a key whose project binding carries no cost permission", () => {
    describe("when the usage is read with that key", () => {
      /** @scenario "A key whose binding lacks the cost grant reads tokens with no cost" */
      it("answers the bound project's tokens with every cost absent", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.viewerToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.rows).toHaveLength(1);
        expect(body.rows[0]).toMatchObject({
          projectId: fixture.projectAId,
          costUsd: null,
          billedCostUsd: null,
          nonBilledCostUsd: null,
        });
        expect(body.rows[0].totalTokens).toBeGreaterThan(0);
        expect(body.totals.costUsd).toBeNull();
      });
    });
  });

  describe("given an organization service key bound organization-wide", () => {
    describe("when the usage is read with that key", () => {
      /** @scenario "An organization service key reads the rollup scoped by its own bindings" */
      it("answers every project the bindings may view and records the read against the key", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.serviceToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(
          body.rows.map((row: { projectId: string }) => row.projectId).sort(),
        ).toEqual([fixture.projectAId, fixture.projectBId].sort());
        expect(body.totals.costUsd).not.toBeNull();

        // A service key acts as nobody, so the record names the key identity
        // — one stable string per credential, never an invented person.
        const recorded = await latestAuditRow();
        expect(recorded?.userId).toBe(`apikey:${fixture.serviceKeyId}`);
        expect(recorded?.targetId).toBe("github.com/acme/widgets#1");
      });
    });
  });

  describe("given a service key whose bindings grant viewing but not pricing", () => {
    describe("when the usage is read with that key", () => {
      /** @scenario "A service key without the cost grant reads tokens with every cost null" */
      it("answers token counts with every cost absent", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.serviceViewerToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.rows).toHaveLength(2);
        for (const row of body.rows) {
          expect(row.totalTokens).toBeGreaterThan(0);
          expect(row.costUsd).toBeNull();
        }
        expect(body.totals.costUsd).toBeNull();
      });
    });
  });

  describe("given a service key bound to one project of the organization", () => {
    describe("when the usage is read with that key", () => {
      /** @scenario "A service key bound to one project sees only that project's rows" */
      it("answers only the bound project", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.serviceProjectToken }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(
          body.rows.map((row: { projectId: string }) => row.projectId),
        ).toEqual([fixture.projectAId]);
        expect(JSON.stringify(body)).not.toContain(fixture.projectBId);
      });
    });
  });

  describe("given the published API document", () => {
    describe("when the operation is inspected", () => {
      const operation = (): { security?: unknown } => {
        const paths = (
          publishedSpec as unknown as {
            paths?: Record<string, { get?: object }>;
          }
        ).paths;
        const op = paths?.[USAGE_SPEC_PATH]?.get;
        if (!op) {
          throw new Error(
            `GET ${USAGE_SPEC_PATH} is missing from the generated OpenAPI document`,
          );
        }
        return op;
      };

      it("publishes the route under the organization API key scheme", () => {
        // The stamped security is what tells an integrator which key to send:
        // the organization credential, never a project one.
        expect(operation().security).toEqual([{ admin_api_key: [] }]);
      });
    });
  });
});
