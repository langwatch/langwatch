import {
  ConnectLicenseRequiredError,
  ConnectServiceNotEntitledError,
  type ContractTerms,
  type HostedCaller,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";
import type { InstantEvalJudgement } from "@langwatch/instant-eval-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { HostedBudgetUsage, HostedJudge } from "../../app/licensing.members.ts";
import type { IssuedLicenseRecord } from "../../repositories/issued-license.repository.ts";
import { MemoryIssuedLicenseRepository } from "../../repositories/memory/memory.issued-license.repository.ts";
import type { ConnectSpendEntry } from "../connect-spend-buffer.service.ts";
import { HostedServicesService } from "../hosted-services.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

const CALLER: HostedCaller = {
  virtualKeyId: "vk-managed",
  organizationId: "org-acme",
  projectId: "project-hidden",
};

const QUESTION = { id: "q1", kind: "boolean" as const, instructions: "Is it polite?" };

function rowFor(overrides: Partial<IssuedLicenseRecord> = {}): IssuedLicenseRecord {
  return {
    id: "license-1",
    licenseId: "lic-1",
    tokenHash: "hash-1",
    organizationId: "org-acme",
    organizationName: "ACME",
    email: "ops@example.com",
    planType: "ENTERPRISE",
    maxMembers: 50,
    maxMembersLite: 0,
    issuedAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z"),
    expiresAt: Temporal.Instant.from("2027-01-01T00:00:00.000Z"),
    source: "BACKOFFICE",
    issuedById: "operator-1",
    revokedAt: null,
    revokedById: null,
    revokedReason: null,
    supersededAt: null,
    replacesId: null,
    pendingDeliveryLicense: null,
    services: ["instant_evals"],
    seatRateCents: null,
    seatCurrency: null,
    commitUsdCents: 100_000,
    overageEnabled: false,
    overageMaxUsdCents: null,
    instanceId: "instance-1",
    instanceBoundAt: NOW,
    lastSyncAt: null,
    lastSyncVersion: null,
    reportedMembers: null,
    reportedMembersLite: null,
    virtualKeyId: "vk-managed",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const TERMS: ContractTerms = {
  commitUsdCents: 100_000,
  maximumUsdCents: 100_000,
  overageEnabled: false,
  services: ["instant_evals"],
  termEndsAt: "2027-01-01T00:00:00Z",
  termStartsAt: "2025-12-01T00:00:00Z",
};

class RecordingJudge implements HostedJudge {
  readonly seen: { projectId: string; text: string }[] = [];

  constructor(private readonly judgement: InstantEvalJudgement) {}

  async classify(input: { projectId: string; text: string }): Promise<InstantEvalJudgement> {
    this.seen.push({ projectId: input.projectId, text: input.text });
    return this.judgement;
  }

  priceOf({ inputTokens }: { inputTokens: number }) {
    const costUsd = (inputTokens / 1_000_000) * 0.042;
    return { costUsd, priceUsd: costUsd * 1.3 };
  }
}

function budget(overrides: Partial<HostedBudgetUsage> = {}): HostedBudgetUsage {
  return {
    id: "budget-contract",
    scope: "organization",
    window: "manual",
    limitUsd: 1000,
    spentUsd: 120,
    onBreach: "block",
    periodStartedAt: Temporal.Instant.from("2025-12-01T00:00:00.000Z"),
    isContract: true,
    ...overrides,
  };
}

function harness(options: {
  rows?: IssuedLicenseRecord[];
  judgement?: InstantEvalJudgement;
  budgets?: HostedBudgetUsage[];
  spendAvailable?: boolean;
  terms?: ContractTerms;
}) {
  const spend: ConnectSpendEntry[] = [];
  const judge = new RecordingJudge(
    options.judgement ?? { verdicts: [], inputTokens: 1_000_000, isTextTruncated: false },
  );
  const caps: { organizationId: string; capUsdCents: number }[] = [];
  const service = HostedServicesService.create({
    licenses: MemoryIssuedLicenseRepository.create(options.rows ?? [rowFor()]),
    judge,
    spend: { add: (entry) => void spend.push(entry) },
    usage: {
      read: async () => ({
        budgets: options.budgets ?? [budget()],
        spendAvailable: options.spendAvailable ?? true,
        readAt: NOW,
      }),
    },
    contractBudgets: {
      termsOf: async () => options.terms ?? TERMS,
      setCap: async (input) => {
        caps.push(input);
        return { capUsdCents: input.capUsdCents, maximumUsdCents: TERMS.maximumUsdCents };
      },
    },
    now: () => NOW,
  });
  return { service, spend, judge, caps };
}

describe("HostedServicesService.classify", () => {
  /** @scenario "The customer is charged the list rate and never sees the provider cost" */
  it("charges the list rate and never states the provider cost", async () => {
    const { service, spend } = harness({});

    const answer = await service.classify({
      caller: CALLER,
      payload: { text: "hello", questions: [QUESTION] },
    });

    expect(answer.charged_usd).toBeCloseTo(0.042 * 1.3, 10);
    expect(answer).not.toHaveProperty("cost_usd");
    expect(spend[0]?.costUsd).toBeCloseTo(0.042, 10);
    expect(spend[0]?.priceUsd).toBeCloseTo(0.042 * 1.3, 10);
  });

  /** @scenario "A license without the entitlement is refused" */
  it("refuses a license the service is not part of, judging nothing", async () => {
    const { service, spend, judge } = harness({ rows: [rowFor({ services: ["managed_models"] })] });

    await expect(
      service.classify({ caller: CALLER, payload: { text: "hello", questions: [QUESTION] } }),
    ).rejects.toBeInstanceOf(ConnectServiceNotEntitledError);
    expect(judge.seen).toEqual([]);
    expect(spend).toEqual([]);
  });

  /** @scenario "A judge that skips reports the reason and costs nothing" */
  it("reports the skip reason and meters nothing", async () => {
    const { service, spend } = harness({
      judgement: {
        verdicts: [],
        skippedReason: "classifier_rate_limited",
        inputTokens: 0,
        isTextTruncated: false,
      },
    });

    const answer = await service.classify({
      caller: CALLER,
      payload: { text: "hello", questions: [QUESTION] },
    });

    expect(answer.skipped_reason).toBe("classifier_rate_limited");
    expect(spend).toEqual([]);
  });

  /** @scenario "Judged text is not stored" */
  it("meters token counts and cost only, never the judged text", async () => {
    const { service, spend } = harness({});

    await service.classify({
      caller: CALLER,
      payload: { text: "a private sentence", questions: [QUESTION] },
    });

    expect(Object.keys(spend[0] ?? {}).toSorted()).toEqual([
      "costUsd",
      "inputTokens",
      "priceUsd",
      "projectId",
      "virtualKeyId",
    ]);
  });

  it("refuses a payload that is not a classify request", async () => {
    const { service } = harness({});

    await expect(
      service.classify({ caller: CALLER, payload: { text: "", questions: [] } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("judges for the key itself when the caller names no project", async () => {
    const { service, judge } = harness({});

    await service.classify({
      caller: { ...CALLER, projectId: null },
      payload: { text: "hello", questions: [QUESTION] },
    });

    expect(judge.seen[0]?.projectId).toBe("vk-managed");
  });
});

describe("HostedServicesService.usage", () => {
  /** @scenario "A connected install reads its usage" */
  it("states what was spent, the cap, what remains and the entitled services", async () => {
    const { service } = harness({});

    const answer = await service.usage({ caller: CALLER });

    expect(answer.contract).toMatchObject({
      cap_usd: 1000,
      spent_usd: 120,
      remaining_usd: 880,
      commit_usd: 1000,
      period_started_at: "2025-12-01T00:00:00Z",
    });
    expect(answer.services).toEqual(["instant_evals"]);
  });

  /** @scenario "A virtual key reads its usage too" */
  it("answers a plain virtual key with its budgets and no entitled services", async () => {
    const { service } = harness({ rows: [] });

    const answer = await service.usage({ caller: CALLER });

    expect(answer.services).toEqual([]);
    expect(answer.contract).toBeNull();
    expect(answer.budgets).toHaveLength(1);
  });

  /** @scenario "Usage says so when live spend is not available" */
  it("marks spend unavailable rather than reporting zero", async () => {
    const { service } = harness({
      spendAvailable: false,
      budgets: [budget({ spentUsd: null })],
    });

    const answer = await service.usage({ caller: CALLER });

    expect(answer.spend_available).toBe(false);
    expect(answer.contract?.spent_usd).toBeNull();
    expect(answer.contract?.remaining_usd).toBeNull();
  });

  /** @scenario "Usage without any budget reports no cap" */
  it("reports no contract where the organization has no budget", async () => {
    const { service } = harness({ budgets: [] });

    const answer = await service.usage({ caller: CALLER });

    expect(answer.contract).toBeNull();
    expect(answer.budgets).toEqual([]);
  });
});

describe("HostedServicesService.setBudget", () => {
  /** @scenario "A virtual key cannot change a budget through this route" */
  it("refuses a caller that holds no license", async () => {
    const { service } = harness({ rows: [] });

    await expect(
      service.setBudget({ caller: CALLER, payload: { cap_usd: 500 } }),
    ).rejects.toBeInstanceOf(ConnectLicenseRequiredError);
  });

  /** @scenario "A cap that is not a positive amount is refused" */
  it("refuses a cap that is not a positive amount", async () => {
    const { service } = harness({});

    await expect(
      service.setBudget({ caller: CALLER, payload: { cap_usd: 0 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("moves the cap to the cent and answers the maximum it may reach", async () => {
    const { service, caps } = harness({});

    const answer = await service.setBudget({ caller: CALLER, payload: { cap_usd: 250.5 } });

    expect(caps).toEqual([{ organizationId: "org-acme", capUsdCents: 25_050 }]);
    expect(answer).toEqual({ cap_usd: 250.5, maximum_cap_usd: 1000 });
  });

  it("treats a license of another customer as no license at all", async () => {
    const { service } = harness({ rows: [rowFor({ organizationId: "org-other" })] });

    await expect(
      service.setBudget({ caller: CALLER, payload: { cap_usd: 500 } }),
    ).rejects.toBeInstanceOf(ConnectLicenseRequiredError);
  });
});
