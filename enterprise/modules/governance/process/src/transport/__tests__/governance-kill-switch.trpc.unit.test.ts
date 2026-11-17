// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governanceKillSwitch.*` over the real tRPC runtime: the plan gate and the confirmed plan ids.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView, GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { governanceKillSwitchTrpcTransport } from "../governance-kill-switch.trpc.ts";
import { governanceTrpcMembers, governanceTrpcRuntime } from "./support/governance-trpc.fixture.ts";

function mount({ holdsRegistry }: { holdsRegistry: boolean }) {
  const asked: string[] = [];
  const entitlementsAsked: string[] = [];
  const requests: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    requestAgentStop: async (input) => {
      requests.push(input);
      return { id: "agentstop_1" } as AgentStopView;
    },
    createAwsConnection: async (input) => {
      requests.push(input);
      return {
        id: "awsconn_1",
        name: input.connection.name,
        accessKeyIdLastFour: null,
        roleArn: input.connection.roleArn ?? null,
        externalId: "langwatch-generated-0001",
        createdAt: "2026-11-17T00:00:00.000Z",
      };
    },
  });
  const router = governanceTrpcRuntime({
    ...governanceTrpcMembers({ permits: () => true, asked }),
    entitlements: {
      holds: async ({ entitlement }) => {
        entitlementsAsked.push(entitlement);
        return holdsRegistry;
      },
      refusal: ({ feature }) =>
        Object.assign(new Error(`plan lacks ${feature}`), { code: "plan_feature_unavailable" }),
    },
  }).mount(governanceKillSwitchTrpcTransport, () => app);
  const caller = router.createCaller({ actor: { id: "user_1" } });
  return { caller, asked, entitlementsAsked, requests };
}

const STOP = {
  organizationId: "org_1",
  agentId: "agent_1",
  reason: "prompt injection",
  expectedTargetIds: ["target_1"],
};

describe("the governanceKillSwitch tRPC namespace", () => {
  describe("when the organisation's plan lacks the agent registry", () => {
    /** @scenario "The kill switch procedures need an Enterprise plan with the agent registry" */
    it("refuses a stop after the permission and never reaches the application", async () => {
      const { caller, asked, entitlementsAsked, requests } = mount({ holdsRegistry: false });

      const refusal = await caller.requestStop(STOP).then(
        () => undefined,
        (error: { code?: string; cause?: { code?: string } }) => error.cause?.code ?? error.code,
      );

      expect(refusal).toBe("plan_feature_unavailable");
      expect(asked).toEqual(["governance:manage"]);
      expect(entitlementsAsked).toEqual(["enterprise"]);
      expect(requests).toEqual([]);
    });
  });

  describe("when the organisation holds the agent registry", () => {
    it("passes the confirmed plan target ids to the stop", async () => {
      const { caller, requests } = mount({ holdsRegistry: true });

      await caller.requestStop(STOP);

      expect(requests).toEqual([
        {
          organizationId: "org_1",
          agentId: "agent_1",
          reason: "prompt injection",
          severity: "high",
          expectedTargetIds: ["target_1"],
          caller: { userId: "user_1", apiKeyId: null },
        },
      ]);
    });
  });

  describe("when a caller sends its own external id for a role", () => {
    it("strips it at the door, so the application never sees a caller-chosen id", async () => {
      const { caller, requests } = mount({ holdsRegistry: true });
      const connection = {
        name: "ACME role",
        roleArn: "arn:aws:iam::123456789012:role/kill-switch",
        externalId: "acme-chosen-id",
      };

      const view = await caller.createAwsConnection({ organizationId: "org_1", connection });

      expect(requests).toEqual([
        {
          organizationId: "org_1",
          connection: { name: "ACME role", roleArn: "arn:aws:iam::123456789012:role/kill-switch" },
          userId: "user_1",
        },
      ]);
      expect(view.externalId).toBe("langwatch-generated-0001");
    });
  });
});
