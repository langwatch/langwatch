/**
 * @vitest-environment node
 * @integration
 *
 * The refusals the v1 pull-request usage door answers with, each on its own
 * stable code: a legacy project key is turned away before anything is read,
 * and a key from another organization learns nothing about a pull request
 * mapped elsewhere.
 *
 * Every refusal is asserted on its code rather than its sentence. The code is
 * the contract a CLI or an agent branches on; the sentence beside it is copy
 * and will change. The golden-path and key-ceiling cases live in
 * pull-request-usage-v1-api.integration.test.ts; the shared fixture in
 * pullRequestUsageV1Harness.ts.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetApp } from "~/server/app-layer/app";
import { app } from "../[[...route]]/app.v1";
import {
  bearer,
  cleanupPullRequestUsageV1Fixture,
  type PullRequestUsageV1Fixture,
  seedPullRequestUsageV1Fixture,
  USAGE_PATH,
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

describe("Feature: Pull request usage v1 REST API refusals", () => {
  describe("given a legacy project API key", () => {
    describe("when the usage is read", () => {
      /** @scenario "A legacy project key cannot reach the v1 usage read" */
      it("refuses with the credential class mismatch code, naming the class to swap to", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.legacyProjectKey }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.code).toBe("credential_class_mismatch");
        expect(body.meta).toMatchObject({
          required: "organization_api_key",
          presented: "project_api_key",
        });
      });
    });
  });

  describe("given a user-bound key from another organization", () => {
    describe("when the usage is read for a pull request mapped elsewhere", () => {
      /** @scenario "An organization key from another organization learns nothing" */
      it("answers the not-mapped failure without confirming the mapping exists elsewhere", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: bearer({ token: fixture.otherOrgToken }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.code).toBe("github_pr_not_mapped");
        // Nothing on the wire names the organization the mapping belongs to.
        expect(JSON.stringify(body)).not.toContain(fixture.organization.id);
      });
    });
  });
});
