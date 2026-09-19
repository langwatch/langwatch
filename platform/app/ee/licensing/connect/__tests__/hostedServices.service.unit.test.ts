import { describe, expect, it, vi } from "vitest";
import type {
  InstantEvalClassifier,
  InstantEvalJudgement,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { INSTANT_EVAL_PRICING } from "~/server/app-layer/instant-evals/classifier/pricing";
import type { IssuedLicenseRecord } from "../../registry/licenseRegistry.service";
import type { ConnectSpendEntry } from "../connectSpendBuffer";
import { ContractBudgetService } from "../contractBudget.service";
import {
  type HostedBudgetUsage,
  type HostedCaller,
  HostedServicesService,
} from "../hostedServices.service";
import {
  ACME,
  InMemoryContractBudgetStore,
  license,
  NOW,
} from "./connectFakes";

const QUESTION = {
  id: "annoyed",
  kind: "boolean",
  instructions: "Is the customer annoyed?",
} as const;

const JUDGED: InstantEvalJudgement = {
  verdicts: [{ questionId: "annoyed", probability: 0.91 }],
  inputTokens: 1_000_000,
  isTextTruncated: false,
};

function build({
  licenses,
  judgement = JUDGED,
  budgets = [],
  spendAvailable = true,
}: {
  licenses: IssuedLicenseRecord[];
  judgement?: InstantEvalJudgement;
  budgets?: HostedBudgetUsage[];
  spendAvailable?: boolean;
}) {
  const spend: ConnectSpendEntry[] = [];
  const classify = vi.fn(async () => judgement);
  const classifier = {
    limits: {} as InstantEvalClassifier["limits"],
    pricing: INSTANT_EVAL_PRICING,
    classify,
  } satisfies InstantEvalClassifier;
  const store = new InMemoryContractBudgetStore();
  const contractBudgets = new ContractBudgetService({
    store,
    licensesOf: async () => licenses,
    systemActorId: "system:connect-license",
    now: () => NOW,
  });
  const service = new HostedServicesService({
    licenseOfKey: async (virtualKeyId) =>
      licenses.find((row) => row.virtualKeyId === virtualKeyId) ?? null,
    classifier: () => classifier,
    spend: { add: (entry) => void spend.push(entry) },
    usage: {
      read: async () => ({
        budgets: budgets.map((budget) => ({
          ...budget,
          spentUsd: spendAvailable ? budget.spentUsd : null,
        })),
        spendAvailable,
        readAt: NOW,
      }),
    },
    contractBudgets,
    now: () => NOW,
  });
  return { service, spend, classify, store, contractBudgets };
}

const callerOf = (row: IssuedLicenseRecord): HostedCaller => ({
  virtualKeyId: row.virtualKeyId as string,
  organizationId: ACME,
  projectId: "proj_hidden",
});

const VIRTUAL_KEY_CALLER: HostedCaller = {
  virtualKeyId: "vk_customer",
  organizationId: ACME,
  projectId: "proj_app",
};

const contractBudget = (spentUsd: number | null): HostedBudgetUsage => ({
  id: "budget_1",
  scope: "organization",
  window: "manual",
  limitUsd: 1000,
  spentUsd,
  onBreach: "block",
  periodStartedAt: NOW,
  isContract: true,
});

describe("HostedServicesService", () => {
  describe("classify", () => {
    describe("given a license entitled to instant_evals", () => {
      /** @scenario The customer is charged the list rate and never sees the provider cost */
      it("meters the list rate under the managed key and answers without the provider cost", async () => {
        const row = license();
        const { service, spend } = build({ licenses: [row] });

        const answer = await service.classify({
          caller: callerOf(row),
          payload: { text: "I want a refund, again.", questions: [QUESTION] },
        });

        const listPrice =
          INSTANT_EVAL_PRICING.usdPerMillionInputTokens *
          INSTANT_EVAL_PRICING.markup;
        expect(answer).toEqual({
          verdicts: JUDGED.verdicts,
          input_tokens: 1_000_000,
          is_text_truncated: false,
          charged_usd: listPrice,
        });
        expect(JSON.stringify(answer)).not.toContain("cost");
        expect(spend).toEqual([
          {
            virtualKeyId: row.virtualKeyId,
            projectId: "proj_hidden",
            inputTokens: 1_000_000,
            costUsd: INSTANT_EVAL_PRICING.usdPerMillionInputTokens,
            priceUsd: listPrice,
          },
        ]);
      });

      /** @scenario Judged text is not stored */
      it("hands the text to the judge and keeps only counts and cost", async () => {
        const row = license();
        const { service, spend, classify } = build({ licenses: [row] });
        const text = "My card number is on the last invoice you sent.";

        await service.classify({
          caller: callerOf(row),
          payload: { text, questions: [QUESTION] },
        });

        expect(classify).toHaveBeenCalledWith(
          { projectId: "proj_hidden", text, questions: [QUESTION] },
          undefined,
        );
        expect(JSON.stringify(spend)).not.toContain("card number");
        expect(JSON.stringify(spend)).not.toContain("annoyed");
      });

      /** @scenario A connected customer is governed by its contract budget, not the free allowance */
      it("judges for an organization with no Cloud subscription, consulting no free allowance", async () => {
        const row = license();
        const { service } = build({ licenses: [row] });

        await expect(
          service.classify({
            caller: callerOf(row),
            payload: { text: "hello", questions: [QUESTION] },
          }),
        ).resolves.toMatchObject({ input_tokens: 1_000_000 });
      });

      /** @scenario A judge that skips reports the reason and costs nothing */
      it("reports a skip with its reason and meters nothing", async () => {
        const row = license();
        const { service, spend } = build({
          licenses: [row],
          judgement: {
            verdicts: [],
            skippedReason: "classifier_rate_limited",
            inputTokens: 0,
            isTextTruncated: false,
          },
        });

        const answer = await service.classify({
          caller: callerOf(row),
          payload: { text: "hello", questions: [QUESTION] },
        });

        expect(answer).toMatchObject({
          skipped_reason: "classifier_rate_limited",
          input_tokens: 0,
          charged_usd: 0,
        });
        expect(spend).toEqual([]);
      });

      it("refuses a payload that is not a text with questions", async () => {
        const row = license();
        const { service, classify } = build({ licenses: [row] });

        await expect(
          service.classify({ caller: callerOf(row), payload: { text: "" } }),
        ).rejects.toMatchObject({ code: "validation_error" });
        expect(classify).not.toHaveBeenCalled();
      });
    });

    describe("given a license without the entitlement", () => {
      /** @scenario A license without the entitlement is refused */
      it("refuses with connect_service_not_entitled, judging and metering nothing", async () => {
        const row = license({ services: [] });
        const { service, spend, classify } = build({ licenses: [row] });

        await expect(
          service.classify({
            caller: callerOf(row),
            payload: { text: "hello", questions: [QUESTION] },
          }),
        ).rejects.toMatchObject({ code: "connect_service_not_entitled" });
        expect(classify).not.toHaveBeenCalled();
        expect(spend).toEqual([]);
      });
    });

    describe("given a license revoked after the gateway cached its credential", () => {
      it("refuses, because state is read again on every call", async () => {
        const row = license({ revokedAt: NOW });
        const { service, classify } = build({ licenses: [row] });

        await expect(
          service.classify({
            caller: callerOf(row),
            payload: { text: "hello", questions: [QUESTION] },
          }),
        ).rejects.toMatchObject({ code: "connect_service_not_entitled" });
        expect(classify).not.toHaveBeenCalled();
      });
    });

    describe("given a key that belongs to another organization's license", () => {
      it("refuses, whatever organization the key claims", async () => {
        const row = license({ organizationId: "org_other" });
        const { service } = build({ licenses: [row] });

        await expect(
          service.classify({
            caller: callerOf(row),
            payload: { text: "hello", questions: [QUESTION] },
          }),
        ).rejects.toMatchObject({ code: "connect_service_not_entitled" });
      });
    });
  });

  describe("usage", () => {
    /** @scenario A connected install reads its usage */
    it("reports spend, cap, remaining credit, the period and the entitled services", async () => {
      const row = license();
      const { service, contractBudgets } = build({
        licenses: [row],
        budgets: [contractBudget(120)],
      });
      await contractBudgets.sync({
        organizationId: ACME,
        operatorId: "user_operator",
      });

      const usage = await service.usage({ caller: callerOf(row) });

      expect(usage).toMatchObject({
        services: ["instant_evals"],
        spend_available: true,
        contract: {
          cap_usd: 1000,
          spent_usd: 120,
          remaining_usd: 880,
          commit_usd: 1000,
          maximum_cap_usd: 1000,
          overage_enabled: false,
          period_started_at: NOW.toISOString(),
          term_ends_at: row.expiresAt.toISOString(),
        },
      });
    });

    /** @scenario A virtual key reads its usage too */
    it("shows a virtual key its budgets and no entitled services", async () => {
      const { service } = build({
        licenses: [license()],
        budgets: [
          { ...contractBudget(30), isContract: false, scope: "project" },
        ],
      });

      const usage = await service.usage({ caller: VIRTUAL_KEY_CALLER });

      expect(usage.services).toEqual([]);
      expect(usage.contract).toBeNull();
      expect(usage.budgets).toMatchObject([
        { scope: "project", cap_usd: 1000, spent_usd: 30, remaining_usd: 970 },
      ]);
    });

    /** @scenario Usage says so when live spend is not available */
    it("marks spend as unavailable and never reports zero spent", async () => {
      const row = license();
      const { service } = build({
        licenses: [row],
        budgets: [contractBudget(120)],
        spendAvailable: false,
      });

      const usage = await service.usage({ caller: callerOf(row) });

      expect(usage.spend_available).toBe(false);
      expect(usage.budgets).toMatchObject([
        { spent_usd: null, remaining_usd: null, cap_usd: 1000 },
      ]);
    });

    /** @scenario Usage without any budget reports no cap */
    it("reports no contract and no budgets for an organization that has none", async () => {
      const row = license({ commitUsdCents: 0 });
      const { service } = build({ licenses: [row] });

      const usage = await service.usage({ caller: callerOf(row) });

      expect(usage.contract).toBeNull();
      expect(usage.budgets).toEqual([]);
    });
  });

  describe("setBudget", () => {
    /** @scenario A virtual key cannot change a budget through this route */
    it("refuses a virtual key with connect_license_required", async () => {
      const { service, store } = build({ licenses: [license()] });

      await expect(
        service.setBudget({
          caller: VIRTUAL_KEY_CALLER,
          payload: { cap_usd: 400 },
        }),
      ).rejects.toMatchObject({ code: "connect_license_required" });
      expect(store.writes).toEqual([]);
    });

    it("sets the cap for a license, in dollars to the cent", async () => {
      const row = license();
      const { service, store, contractBudgets } = build({ licenses: [row] });
      await contractBudgets.sync({
        organizationId: ACME,
        operatorId: "user_operator",
      });

      const answer = await service.setBudget({
        caller: callerOf(row),
        payload: { cap_usd: 400.5 },
      });

      expect(answer).toEqual({ cap_usd: 400.5, maximum_cap_usd: 1000 });
      expect(store.budget?.limitUsdCents).toBe(40_050);
    });

    it("refuses a cap that is not a positive number", async () => {
      const row = license();
      const { service } = build({ licenses: [row] });

      await expect(
        service.setBudget({ caller: callerOf(row), payload: { cap_usd: -1 } }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });
});
