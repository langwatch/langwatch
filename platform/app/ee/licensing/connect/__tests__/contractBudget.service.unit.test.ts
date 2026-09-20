import { beforeEach, describe, expect, it } from "vitest";
import type { IssuedLicenseRecord } from "../../registry/issuedLicense";
import { ContractBudgetService } from "../contractBudget.service";
import { contractTermsOf } from "../contractTerms";
import {
  ACME,
  InMemoryContractBudgetStore,
  license,
  NEXT_YEAR,
  NOW,
} from "./connectFakes";

const OPERATOR = "user_operator";
const SYSTEM = "system:connect-license";

function build(licenses: IssuedLicenseRecord[]) {
  const store = new InMemoryContractBudgetStore();
  const service = new ContractBudgetService({
    store,
    licensesOf: async () => licenses,
    systemActorId: SYSTEM,
    now: () => NOW,
  });
  return { store, service, licenses };
}

describe("contractTermsOf", () => {
  describe("given a customer with two active licenses, one with overage agreed", () => {
    it("sums the commits and adds only the overage that is switched on", () => {
      const terms = contractTermsOf({
        now: NOW,
        licenses: [
          license({ commitUsdCents: 100_000 }),
          license({
            commitUsdCents: 50_000,
            overageEnabled: true,
            overageMaxUsdCents: 25_000,
            services: ["instant_evals", "managed_models"],
          }),
          license({
            commitUsdCents: 70_000,
            overageEnabled: false,
            overageMaxUsdCents: 99_000,
          }),
        ],
      });

      expect(terms).toMatchObject({
        commitUsdCents: 220_000,
        maximumUsdCents: 245_000,
        overageEnabled: true,
        termEndsAt: NEXT_YEAR,
      });
      expect(terms.services.sort()).toEqual([
        "instant_evals",
        "managed_models",
      ]);
    });
  });

  describe("given licenses that no longer count", () => {
    it("leaves out revoked, expired and superseded licenses", () => {
      const terms = contractTermsOf({
        now: NOW,
        licenses: [
          license({ revokedAt: NOW }),
          license({ expiresAt: new Date(NOW.getTime() - 1) }),
          license({ supersededAt: NOW }),
        ],
      });

      expect(terms).toMatchObject({
        commitUsdCents: 0,
        maximumUsdCents: 0,
        termEndsAt: null,
      });
    });
  });

  describe("given a license that was reissued and whose replacement is not delivered yet", () => {
    it("counts the commit once, although both licenses are still valid", () => {
      const original = license({ commitUsdCents: 100_000 });
      const replacement = license({
        commitUsdCents: 100_000,
        replacesId: original.id,
      });

      expect(
        contractTermsOf({ now: NOW, licenses: [original, replacement] })
          .commitUsdCents,
      ).toBe(100_000);
    });
  });
});

describe("ContractBudgetService", () => {
  describe("given a customer whose commit was just agreed", () => {
    describe("when the terms are synced", () => {
      it("creates the budget equal to the commit, attributed to the operator", async () => {
        const { store, service } = build([
          license({ commitUsdCents: 100_000 }),
        ]);

        await service.sync({ organizationId: ACME, operatorId: OPERATOR });

        expect(store.budget).toMatchObject({
          limitUsdCents: 100_000,
          capSetByCustomer: false,
        });
        expect(store.writes).toEqual([
          { limitUsdCents: 100_000, actorId: OPERATOR },
        ]);
      });
    });

    describe("when nothing was agreed at all", () => {
      it("creates no budget", async () => {
        const { store, service } = build([license({ commitUsdCents: 0 })]);

        await service.sync({ organizationId: ACME, operatorId: OPERATOR });

        expect(store.budget).toBeNull();
      });
    });
  });

  describe("given a budget that follows the commit", () => {
    let context: ReturnType<typeof build>;

    beforeEach(async () => {
      context = build([license({ commitUsdCents: 100_000 })]);
      await context.service.sync({
        organizationId: ACME,
        operatorId: OPERATOR,
      });
    });

    describe("when the commit is raised", () => {
      it("raises the cap with it", async () => {
        const [current] = context.licenses;
        if (current) current.commitUsdCents = 200_000;

        await context.service.sync({
          organizationId: ACME,
          operatorId: OPERATOR,
        });

        expect(context.store.budget?.limitUsdCents).toBe(200_000);
      });
    });

    describe("when the customer lowers its own cap", () => {
      /** @scenario A customer lowers its own cap */
      it("sets the budget to that cap and remembers that the customer chose it", async () => {
        const result = await context.service.setCap({
          organizationId: ACME,
          capUsdCents: 40_000,
        });

        expect(result).toEqual({
          capUsdCents: 40_000,
          maximumUsdCents: 100_000,
        });
        expect(context.store.budget).toMatchObject({
          limitUsdCents: 40_000,
          capSetByCustomer: true,
        });
        expect(context.store.writes.at(-1)?.actorId).toBe(SYSTEM);
      });

      it("keeps the customer's cap when the commit is raised later", async () => {
        await context.service.setCap({
          organizationId: ACME,
          capUsdCents: 40_000,
        });
        const [current] = context.licenses;
        if (current) current.commitUsdCents = 200_000;

        await context.service.sync({
          organizationId: ACME,
          operatorId: OPERATOR,
        });

        expect(context.store.budget?.limitUsdCents).toBe(40_000);
      });

      it("lowers the customer's cap when the new maximum is below it", async () => {
        await context.service.setCap({
          organizationId: ACME,
          capUsdCents: 90_000,
        });
        const [current] = context.licenses;
        if (current) current.commitUsdCents = 50_000;

        await context.service.sync({
          organizationId: ACME,
          operatorId: OPERATOR,
        });

        expect(context.store.budget?.limitUsdCents).toBe(50_000);
      });
    });

    describe("when the customer asks for more than the commit with overage off", () => {
      /** @scenario A cap above the prepaid commit is refused when overage is off */
      it("refuses with the maximum it may set", async () => {
        await expect(
          context.service.setCap({
            organizationId: ACME,
            capUsdCents: 150_000,
          }),
        ).rejects.toMatchObject({
          code: "connect_budget_above_contract_maximum",
          meta: { maximumUsd: 1000 },
        });
        expect(context.store.budget?.limitUsdCents).toBe(100_000);
      });
    });

    describe("when the cap is not a positive amount", () => {
      /** @scenario A cap that is not a positive amount is refused */
      it.each([
        0,
        -500,
        10.5,
        Number.NaN,
      ])("refuses %s cents as invalid", async (capUsdCents) => {
        await expect(
          context.service.setCap({ organizationId: ACME, capUsdCents }),
        ).rejects.toMatchObject({ code: "validation_error" });
      });
    });

    describe("when the cap is set below what was already spent", () => {
      /** @scenario A cap below what is already spent stops further use */
      it("accepts it, because the budget is what stops the next call", async () => {
        await context.service.setCap({
          organizationId: ACME,
          capUsdCents: 10_000,
        });

        expect(context.store.budget?.limitUsdCents).toBe(10_000);
      });
    });
  });

  describe("given overage agreed up to 500 USD on a 1000 USD commit", () => {
    const withOverage = () =>
      build([
        license({
          commitUsdCents: 100_000,
          overageEnabled: true,
          overageMaxUsdCents: 50_000,
        }),
      ]);

    /** @scenario A cap may reach the commit plus the agreed overage maximum */
    it("accepts a cap of 1500 USD", async () => {
      const { store, service } = withOverage();
      await service.sync({ organizationId: ACME, operatorId: OPERATOR });

      await service.setCap({ organizationId: ACME, capUsdCents: 150_000 });

      expect(store.budget?.limitUsdCents).toBe(150_000);
    });

    /** @scenario A cap above the commit plus the overage maximum is refused */
    it("refuses a cap of 1501 USD", async () => {
      const { service } = withOverage();
      await service.sync({ organizationId: ACME, operatorId: OPERATOR });

      await expect(
        service.setCap({ organizationId: ACME, capUsdCents: 150_100 }),
      ).rejects.toMatchObject({
        code: "connect_budget_above_contract_maximum",
        meta: { maximumUsd: 1500 },
      });
    });
  });

  describe("given a customer with no budget agreed", () => {
    it("refuses a cap with connect_budget_not_set", async () => {
      const { service } = build([license({ commitUsdCents: 0 })]);

      await expect(
        service.setCap({ organizationId: ACME, capUsdCents: 10_000 }),
      ).rejects.toMatchObject({ code: "connect_budget_not_set" });
    });
  });
});
