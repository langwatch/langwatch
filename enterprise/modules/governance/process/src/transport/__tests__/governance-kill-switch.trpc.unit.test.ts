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

function mount({
  holdsRegistry,
  impersonatorId,
}: {
  holdsRegistry: boolean;
  impersonatorId?: string;
}) {
  const asked: string[] = [];
  const genericRows: unknown[] = [];
  const entitlementsAsked: string[] = [];
  const requests: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    requestAgentStop: async (input) => {
      requests.push(input);
      return { id: "agentstop_1" } as AgentStopView;
    },
    setAgentStopPlan: async (input) => {
      requests.push(input);
      return { agentId: input.agentId, targets: [], updatedAt: null, version: 1 };
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
  const members = governanceTrpcMembers({ permits: () => true, asked });
  const router = governanceTrpcRuntime({
    ...members,
    audit: {
      ...members.audit,
      record: async (row) => {
        genericRows.push(row);
      },
    },
    entitlements: {
      holds: async ({ entitlement }) => {
        entitlementsAsked.push(entitlement);
        return holdsRegistry;
      },
      refusal: ({ feature }) =>
        Object.assign(new Error(`plan lacks ${feature}`), { code: "plan_feature_unavailable" }),
    },
  }).mount(governanceKillSwitchTrpcTransport, () => app);
  const caller = router.createCaller({
    actor: { id: "user_1", ...(impersonatorId ? { impersonatorId } : {}) },
  });
  return { caller, asked, entitlementsAsked, requests, genericRows };
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

  describe("when an operator impersonating a person stops an agent and adds a connection", () => {
    /** @scenario "An impersonated kill switch write names the operator in its audit row" */
    it("hands the service the operator beside the person, and writes no generic row", async () => {
      const { caller, requests, genericRows } = mount({
        holdsRegistry: true,
        impersonatorId: "operator_1",
      });

      await caller.requestStop(STOP);
      await caller.createAwsConnection({
        organizationId: "org_1",
        connection: { name: "ACME role", roleArn: "arn:aws:iam::123456789012:role/kill-switch" },
      });

      expect(requests).toEqual([
        expect.objectContaining({
          caller: { userId: "user_1", apiKeyId: null, impersonatorId: "operator_1" },
        }),
        expect.objectContaining({ userId: "user_1", impersonatorId: "operator_1" }),
      ]);
      expect(genericRows).toEqual([]);
    });
  });

  describe("when a person saves a stop plan from the governance UI", () => {
    /** @scenario "Saving a stop plan writes one audit row naming the agent" */
    it("hands the service the person who saved it, and writes no generic row", async () => {
      const { caller, requests, genericRows } = mount({ holdsRegistry: true });

      await caller.setPlan({ organizationId: "org_1", agentId: "agent_1", targets: [] });

      expect(requests).toEqual([
        {
          organizationId: "org_1",
          agentId: "agent_1",
          targets: [],
          caller: { userId: "user_1", apiKeyId: null },
        },
      ]);
      expect(genericRows).toEqual([]);
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
