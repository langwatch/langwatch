/**
 * The Enterprise application slot, member by member.
 *
 * The slot was empty and its port carried its eight members as two objects, so the whole
 * of Enterprise on this process answered one question: did a host inject an application?
 * Nothing did, so the session rules, the webhook endpoints and the operator's connection
 * back office all refused even though the API holds everything the three need. What is
 * pinned here is that the three are composed, that the other five stay absent, and that a
 * consumer reads the member it needs rather than the object it sits on — so one absent
 * member never takes a present one down with it.
 *
 * @see apps/api/src/app/api-enterprise-application.composition.ts
 * @see apps/api/src/features/enterprise/enterprise.composition.ts
 * @see apps/api/src/features/enterprise/enterprise-governance.composition.ts
 */
// @vitest-environment node
import type { EventSourcing } from "@langwatch/eventing";
import { PlatformOperator } from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryption } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";

import { composeEnterpriseGovernanceApplication } from "../../features/enterprise/enterprise-governance.composition.ts";
import {
  composeEnterpriseFeature,
  type ApiEnterpriseApplication,
} from "../../features/enterprise/enterprise.composition.ts";
import { ApiUnavailableSsoConnectionLedger } from "../../features/sso/sso-process.ports.ts";
import { composeApiEnterpriseApplication } from "../api-enterprise-application.composition.ts";

/**
 * The connection, as every store under the slot reads it. The four `processManager*`
 * models are what the durable process store checks for before it will construct, which is
 * the same check production makes.
 */
function testDatabase(): PrismaClient {
  const model = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() };
  return {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
    webhookEndpoint: model,
    ssoConnection: model,
    ssoConnectionStranding: model,
    organization: model,
    organizationSessionPolicy: model,
    user: model,
    project: {},
  } as unknown as PrismaClient;
}

function testCipher(): SecretEncryption {
  return {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ""),
  } as SecretEncryption;
}

function testEventSourcing(): EventSourcing {
  return {
    isEnabled: false,
    getEventStore: vi.fn(),
    getPipeline: vi.fn(),
  } as unknown as EventSourcing;
}

class TestOperators extends PlatformOperator {
  isPlatformOperatorEmail(): boolean {
    return false;
  }
}

function compose(
  overrides: Partial<Parameters<typeof composeApiEnterpriseApplication>[0]> = {},
): ApiEnterpriseApplication {
  return composeApiEnterpriseApplication({
    prisma: testDatabase(),
    encryption: testCipher(),
    resolveClickHouseClient: null,
    plans: undefined,
    eventSourcing: testEventSourcing(),
    operators: new TestOperators(),
    ...overrides,
  });
}

/** What a refusal reads as at the boundary. */
async function refusalFrom(act: () => unknown): Promise<string> {
  try {
    const answer = await act();
    throw new Error(`the call answered instead of refusing: ${String(answer)}`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("the API's Enterprise application slot", () => {
  describe("given a process holding a database, the cipher and a queue", () => {
    /** @scenario "The session rules are composed over the process's own database" */
    it("composes the session-policy store over that database", () => {
      expect(compose().sessionPolicy?.get).toBeTypeOf("function");
    });

    /** @scenario "The webhook application is composed with its delivery health" */
    it("composes the webhook application with its registry and its delivery health", () => {
      const webhooks = compose().webhooks;

      expect(webhooks?.endpoints.getAll).toBeTypeOf("function");
      expect(webhooks?.health.health).toBeTypeOf("function");
    });

    /** @scenario "The operator's connection back office is composed" */
    it("composes the operator's single sign-on back office", () => {
      const backoffice = compose().backoffice?.();

      expect(backoffice?.list).toBeTypeOf("function");
      expect(backoffice?.findById).toBeTypeOf("function");
      expect(backoffice?.requestTeardown).toBeTypeOf("function");
    });

    /**
     * The five that wait on an implementation nothing in this repository has written.
     * Absent rather than a stand-in: a refusing proxy in the slot would move the failure
     * from "this deployment did not compose it" to "it answered and then broke".
     */
    it("leaves the five unbuilt members absent", () => {
      const application = compose();

      expect(application.governance).toBeUndefined();
      expect(application.governanceApp).toBeUndefined();
      expect(application.scimApp).toBeUndefined();
      expect(application.licensing).toBeUndefined();
      expect(application.usageLimits).toBeUndefined();
    });
  });

  describe("when a test fire is dispatched from this process", () => {
    /** @scenario "A test fire refuses because this process delivers nothing" */
    it("refuses by name, because the API runs no delivery process manager", async () => {
      const webhooks = compose().webhooks;
      if (!webhooks) throw new Error("the slot composed no webhook application");

      const message = await refusalFrom(() =>
        webhooks.dispatch({
          destination: {} as never,
          organizationId: "organization_acme",
          endpointId: "webhook_endpoint_1",
          body: "{}",
          batchId: "batch_1",
          attempt: 1,
          signingSecrets: [],
          isTestFire: true,
        }),
      );

      expect(message).toContain("no webhook delivery process manager");
    });
  });

  describe("given a process that composed no queue", () => {
    /** @scenario "A process with no queue composes no connection ledger" */
    it("composes no connection back office, and leaves the other members alone", () => {
      const application = compose({ eventSourcing: undefined });

      expect(application.backoffice).toBeUndefined();
      expect(application.sessionPolicy).toBeDefined();
      expect(application.webhooks).toBeDefined();
    });
  });

  describe("given a process that composed no database", () => {
    /** @scenario "A process with no database composes no member at all" */
    it("composes no member", () => {
      const application = compose({ prisma: undefined });

      expect(application.sessionPolicy).toBeUndefined();
      expect(application.webhooks).toBeUndefined();
      expect(application.backoffice).toBeUndefined();
    });
  });

  describe("when a consumer reads a member the deployment did not compose", () => {
    /** @scenario "An absent member refuses under its own name" */
    it("refuses under that member's name while the composed members still answer", async () => {
      const governanceSlices = composeEnterpriseGovernanceApplication(compose());

      const message = await refusalFrom(() =>
        governanceSlices.governance.departmentList("organization_acme"),
      );

      expect(message).toContain("Enterprise governance capability");
      expect(governanceSlices.sessionPolicy.get).toBeTypeOf("function");
    });

    /** @scenario "The single sign-on back office refuses by name with no ledger composed" */
    it("refuses the back office by name when only that member is absent", async () => {
      const application = compose({ eventSourcing: undefined });
      const connections = application.backoffice?.() ?? ApiUnavailableSsoConnectionLedger.create();

      const message = await refusalFrom(() => connections.list({} as never));

      expect(message).toContain("Enterprise single sign-on ledger");
    });

    it("refuses the SCIM application by name", async () => {
      const feature = composeEnterpriseFeature({ enterprise: compose() });

      const message = await refusalFrom(() =>
        feature.application.scimApp.listTokens({ organizationId: "organization_acme" }),
      );

      expect(message).toContain("Enterprise SCIM application");
    });

    /**
     * A REJECTED promise rather than a synchronous throw. `reportLimitBlocked` fires the
     * notification and swallows its failure (`void notify(...).catch(...)`); a synchronous
     * throw escapes that catch and answers the caller a 500 for a notification whose answer
     * it never needed.
     *
     * @scenario "An absent usage-limit store rejects rather than throwing at the caller"
     */
    it("rejects the usage-limit notification rather than throwing into the caller", async () => {
      const feature = composeEnterpriseFeature({ enterprise: compose() });

      const pending = feature.application.usageLimits.notifyResourceLimitReached({
        organizationId: "organization_acme",
      } as never);

      await expect(pending).rejects.toThrow(/Enterprise usage-limit store/);
    });
  });
});
