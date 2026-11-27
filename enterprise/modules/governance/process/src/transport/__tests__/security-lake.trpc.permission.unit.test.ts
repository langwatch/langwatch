// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The Security Lake procedures that save a source ask for `ingestionSources:manage` before the
 * handler runs. Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ingestionSourcesTrpcTransport } from "../ingestion-sources.trpc.ts";
import { governanceTrpcMembers, governanceTrpcRuntime } from "./support/governance-trpc.fixture.ts";

const MANAGE = "ingestionSources:manage";

const config = {
  region: "eu-west-1",
  subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
  externalId: "acme-external-id",
  queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
};

function mount({ permits }: { permits: (permission: string) => boolean }) {
  const handled: string[] = [];
  const asked: string[] = [];
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
    governanceTrpcMembers({ permits: (permission) => permits(permission), asked }),
  ).mount(ingestionSourcesTrpcTransport, () => app);
  return { handled, asked, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

function create(caller: ReturnType<typeof mount>["caller"]) {
  return caller.securityLakeCreate({
    organizationId: "org_1",
    name: "ACME Security Lake",
    config,
    credentials: { aws_access_key_id: "AKIAEXAMPLE", aws_secret_access_key: "secret" },
  });
}

describe("ingestionSources Security Lake procedures", () => {
  describe("given a member without the ingestion sources manage permission", () => {
    /** @scenario "Only an organisation admin can add or edit a Security Lake source" */
    it("refuses create and update as forbidden before the handler runs", async () => {
      const { caller, handled, asked } = mount({ permits: (permission) => permission !== MANAGE });

      await expect(create(caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.securityLakeUpdate({ organizationId: "org_1", id: "src_1", name: "Renamed" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(asked).toContain(MANAGE);
      expect(handled).toEqual([]);
    });
  });

  describe("given an admin holding the permission", () => {
    it("runs the create and update handlers", async () => {
      const { caller, handled } = mount({ permits: () => true });

      await create(caller).catch(() => undefined);
      await caller
        .securityLakeUpdate({ organizationId: "org_1", id: "src_1", name: "Renamed" })
        .catch(() => undefined);

      expect(handled).toEqual(["create", "update"]);
    });
  });
});
