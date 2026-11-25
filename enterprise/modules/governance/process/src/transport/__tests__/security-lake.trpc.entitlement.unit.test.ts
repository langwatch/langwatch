// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The Security Lake procedures of `ingestionSources.*` ask for the Enterprise plan before the
 * handler runs, as the REST routes do.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ingestionSourcesTrpcTransport } from "../ingestion-sources.trpc.ts";
import { governanceTrpcMembers, governanceTrpcRuntime } from "./support/governance-trpc.fixture.ts";

const config = {
  region: "eu-west-1",
  subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
  queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
};

function mount({ enterprise }: { enterprise: boolean }) {
  const handled: string[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    securityLakeSourceCreate: async () => {
      handled.push("create");
      return {} as never;
    },
    securityLakeSourceUpdate: async () => {
      handled.push("update");
      return {} as never;
    },
  });
  const router = governanceTrpcRuntime(
    governanceTrpcMembers({ permits: () => true, asked: [], enterprise }),
  ).mount(ingestionSourcesTrpcTransport, () => app);
  return { handled, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("ingestionSources Security Lake procedures", () => {
  describe("given an organisation without the Enterprise plan", () => {
    /** @scenario "Adding or editing a Security Lake source needs the Enterprise plan" */
    it("refuses create and update before the handler runs", async () => {
      const { caller, handled } = mount({ enterprise: false });

      await expect(
        caller.securityLakeCreate({
          organizationId: "org_1",
          name: "ACME Security Lake",
          config,
          credentials: { aws_access_key_id: "AKIAEXAMPLE", aws_secret_access_key: "secret" },
        }),
      ).rejects.toThrow(/enterprise/i);
      await expect(
        caller.securityLakeUpdate({ organizationId: "org_1", id: "src_1", name: "Renamed" }),
      ).rejects.toThrow(/enterprise/i);
      expect(handled).toEqual([]);
    });
  });

  describe("given an organisation on the Enterprise plan", () => {
    it("runs the create handler", async () => {
      const { caller, handled } = mount({ enterprise: true });

      await caller
        .securityLakeCreate({
          organizationId: "org_1",
          name: "ACME Security Lake",
          config,
          credentials: { aws_access_key_id: "AKIAEXAMPLE", aws_secret_access_key: "secret" },
        })
        .catch(() => undefined);
      expect(handled).toEqual(["create"]);
    });
  });
});
