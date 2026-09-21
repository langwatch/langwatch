/**
 * @vitest-environment node
 *
 * The hosted services a self-hosted license calls through the gateway, on the
 * control plane route the gateway forwards to, against real Postgres: the
 * license registry, the managed key, the contract budget and the budgets that
 * apply to a key are all real. The judge and the spend pipeline are stood in
 * for, so the test asserts what is handed to each.
 *
 * Spec: specs/self-hosting/connected-services/hosted-services.feature
 */

import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import {
  CONTRACT_BUDGET_EXTERNAL_ID,
  createContractBudgetService,
} from "@ee/licensing/connect/connect.prisma";
import { flushConnectSpend } from "@ee/licensing/connect/connectSpend.runtime";
import { licenseTokenFromKey } from "@ee/licensing/licenseToken";
import { PrismaConnectManagedKeys } from "@ee/licensing/registry/connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
} from "@ee/licensing/registry/issuedLicense.prisma";
import { LicenseRegistryService } from "@ee/licensing/registry/licenseRegistry.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { InstantEvalSpendRecord } from "~/server/app-layer/instant-evals/instant-eval-spend.recorder";
import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";

const { recorded, judged } = vi.hoisted(() => ({
  recorded: [] as InstantEvalSpendRecord[],
  judged: [] as { projectId: string; text: string }[],
}));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({
    gateway: {
      budgets: new GatewayBudgetClickHouseRepository(async (projectId) => {
        const client = await getClickHouseClientForTenant(projectId);
        if (!client) throw new Error("ClickHouse is not configured");
        return client;
      }),
    },
  }),
}));

vi.mock("~/server/app-layer/instant-evals/classifier", () => ({
  getInstantEvalClassifier: () => ({
    limits: {},
    pricing: { usdPerMillionInputTokens: 0.042, markup: 1.3 },
    classify: async (request: { projectId: string; text: string }) => {
      judged.push({ projectId: request.projectId, text: request.text });
      return {
        verdicts: [{ questionId: "annoyed", probability: 0.9 }],
        inputTokens: 2_000,
        isTextTruncated: false,
      };
    },
  }),
}));

vi.mock("~/server/app-layer/instant-evals/spend", () => ({
  createInstantEvalSpendRecorderForHostedCalls: () => ({
    recordSpend: async (record: InstantEvalSpendRecord) => {
      recorded.push(record);
    },
  }),
}));

import { app } from "../gateway-internal";

const suffix = nanoid(8);
const USER_ID = `usr-hosted-${suffix}`;
const SIGNING_SECRET = randomBytes(16).toString("hex");
const NEXT_YEAR = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const QUESTION = {
  id: "annoyed",
  kind: "boolean",
  instructions: "Is the customer annoyed?",
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

async function signedPost(path: string, body: unknown) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(payload).digest("hex");
  const signature = createHmac("sha256", SIGNING_SECRET)
    .update(`POST\n${path}\n${timestamp}\n${bodyHash}`)
    .digest("hex");
  const res = await app.request(
    new Request(`http://localhost${path}`, {
      method: "POST",
      body: payload,
      headers: {
        "Content-Type": "application/json",
        "X-LangWatch-Gateway-Signature": signature,
        "X-LangWatch-Gateway-Timestamp": timestamp,
      },
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

describe("hosted services on the gateway's control plane route (real PG)", () => {
  const organizationIds: string[] = [];
  const previous: Record<string, string | undefined> = {};
  const registry = new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    seatBilling: { invoiceAddedSeats: async () => "not_onboarded" },
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: createContractBudgetService(prisma),
    signingKey: () => privateKey,
    publicKey,
    encrypt: (plain) => `enc:${plain.length}`,
  });

  /** A customer with a license, resolved once so its managed key exists. */
  const connectedCustomer = async ({
    services = ["instant_evals" as const],
    commitUsdCents = 100_000,
  } = {}) => {
    const { licenseKey, license } = await registry.issue({
      customer: { newOrganizationName: `ACME ${nanoid(6)}` },
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 50,
      expiresAt: NEXT_YEAR,
      terms: { services, commitUsdCents },
      operatorId: USER_ID,
    });
    const organizationId = license.organizationId as string;
    organizationIds.push(organizationId);
    const resolved = await signedPost("/api/internal/gateway/resolve-key", {
      key_presented: licenseTokenFromKey(licenseKey),
      instance_id: "instance-a",
    });
    const key = await prisma.virtualKey.findUniqueOrThrow({
      where: { id: resolved.json.key_id },
    });
    return {
      organizationId,
      envelope: (payload: unknown) => ({
        virtual_key_id: key.id,
        organization_id: organizationId,
        project_id: key.traceProjectId ?? "",
        payload,
      }),
      virtualKeyId: key.id,
      projectId: key.traceProjectId,
    };
  };

  beforeAll(async () => {
    await startTestContainers();
    for (const name of [
      "LW_GATEWAY_INTERNAL_SECRET",
      "LW_GATEWAY_JWT_SECRET",
    ]) {
      previous[name] = process.env[name];
      process.env[name] = SIGNING_SECRET;
    }
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@hosted.local`, name: "Operator" },
    });
  }, 120_000);

  afterAll(async () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const inOrganizations = { organizationId: { in: organizationIds } };
    const keys = await prisma.virtualKey.findMany({
      where: inOrganizations,
      select: { id: true },
    });
    await prisma.issuedLicense.deleteMany({ where: inOrganizations });
    await prisma.gatewayChangeEvent.deleteMany({ where: inOrganizations });
    await prisma.gatewayBudget.deleteMany({ where: inOrganizations });
    await prisma.virtualKeyScope.deleteMany({
      where: { virtualKeyId: { in: keys.map((key) => key.id) } },
    });
    await prisma.virtualKey.deleteMany({ where: inOrganizations });
    await prisma.auditLog.deleteMany({ where: inOrganizations });
    await prisma.project.deleteMany({ where: { team: inOrganizations } });
    await prisma.team.deleteMany({ where: inOrganizations });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  });

  describe("given a license entitled to instant_evals with a 1000 USD commit", () => {
    /** @scenario A classify call is judged and metered under the customer organization */
    it("judges the text and meters it under the license's managed key at the list rate", async () => {
      const customer = await connectedCustomer();

      const { status, json } = await signedPost(
        "/api/internal/gateway/connect/instant-evals-classify",
        customer.envelope({
          text: "Third time I ask for this refund.",
          questions: [QUESTION],
        }),
      );
      await flushConnectSpend();

      expect(status).toBe(200);
      expect(json).toMatchObject({
        verdicts: [{ questionId: "annoyed", probability: 0.9 }],
        input_tokens: 2_000,
      });
      expect(judged.at(-1)).toEqual({
        projectId: customer.projectId,
        text: "Third time I ask for this refund.",
      });
      expect(recorded.at(-1)).toMatchObject({
        virtualKeyId: customer.virtualKeyId,
        projectId: customer.projectId,
        inputTokens: 2_000,
        requests: 1,
        priceUsd: expect.closeTo((2_000 / 1_000_000) * 0.042 * 1.3, 12),
      });
    });

    /** @scenario A caller cannot name another customer's key in its request */
    it("cannot be pointed at another key by what the caller put in its payload", async () => {
      const customer = await connectedCustomer();
      const other = await connectedCustomer();

      await signedPost(
        "/api/internal/gateway/connect/instant-evals-classify",
        customer.envelope({
          text: "hello",
          questions: [QUESTION],
          virtual_key_id: other.virtualKeyId,
          organization_id: other.organizationId,
        }),
      );
      await flushConnectSpend();

      expect(recorded.at(-1)?.virtualKeyId).toBe(customer.virtualKeyId);
    });

    /** @scenario A customer lowers its own cap */
    it("creates the contract budget at the commit, lowers it on request, and reports it", async () => {
      const customer = await connectedCustomer();
      const budget = () =>
        prisma.gatewayBudget.findFirstOrThrow({
          where: {
            organizationId: customer.organizationId,
            externalId: CONTRACT_BUDGET_EXTERNAL_ID,
          },
        });
      expect(await budget()).toMatchObject({
        scopeType: "ORGANIZATION",
        window: "MANUAL",
        onBreach: "BLOCK",
      });
      expect((await budget()).limitUsd.toNumber()).toBe(1000);

      const set = await signedPost(
        "/api/internal/gateway/connect/budget",
        customer.envelope({ cap_usd: 400 }),
      );
      const usage = await signedPost(
        "/api/internal/gateway/connect/usage",
        customer.envelope(null),
      );

      expect(set).toMatchObject({
        status: 200,
        json: { cap_usd: 400, maximum_cap_usd: 1000 },
      });
      expect((await budget()).limitUsd.toNumber()).toBe(400);
      expect(usage.json).toMatchObject({
        services: ["instant_evals"],
        contract: { cap_usd: 400, commit_usd: 1000, maximum_cap_usd: 1000 },
      });
    });

    it("refuses a cap above the commit in the gateway's error envelope", async () => {
      const customer = await connectedCustomer();

      const { status, json } = await signedPost(
        "/api/internal/gateway/connect/budget",
        customer.envelope({ cap_usd: 1500 }),
      );

      expect(status).toBe(400);
      expect(json).toEqual({
        error: {
          type: "connect_budget_above_contract_maximum",
          code: "connect_budget_above_contract_maximum",
          message: "The cap is above the maximum agreed for this license",
          meta: { maximumUsd: 1000 },
        },
      });
    });
  });

  describe("given a license without the instant_evals entitlement", () => {
    it("refuses classify with 403 connect_service_not_entitled and judges nothing", async () => {
      const customer = await connectedCustomer({ services: [] });
      const judgedBefore = judged.length;

      const { status, json } = await signedPost(
        "/api/internal/gateway/connect/instant-evals-classify",
        customer.envelope({ text: "hello", questions: [QUESTION] }),
      );

      expect(status).toBe(403);
      expect(json.error.code).toBe("connect_service_not_entitled");
      expect(judged).toHaveLength(judgedBefore);
    });
  });

  describe("given a call the gateway does not know", () => {
    it("answers 400 without reaching any service", async () => {
      const { status } = await signedPost(
        "/api/internal/gateway/connect/delete-everything",
        { virtual_key_id: "vk", organization_id: "org", project_id: "" },
      );

      expect(status).toBe(400);
    });
  });
});
