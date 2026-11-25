import type { InstanceIdentityView, LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type {
  OpsUpgradeDiagnosticsAvailability,
  OpsUpgradeDiagnosticsReceipt,
  UpgradeDiagnosticsBundle,
} from "@langwatch/ops-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UpgradeReader } from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { MemoryUpgradeLedgerRepository } from "#repositories/memory/memory.upgrade-ledger.repository";

import { stepOf } from "../../../../services/__tests__/support/upgrade-ledger.ts";
import { UpgradeDiagnosticsService } from "../upgrade-diagnostics.service.ts";

type Licensing = Pick<
  LicensingApi,
  | "findInstanceIdentity"
  | "getUpgradeDiagnosticsAvailability"
  | "sendUpgradeDiagnostics"
  | "setUpgradeDiagnosticsOptOut"
>;

const NOW = "2026-10-20T10:00:00.000Z";
const RECEIPT: OpsUpgradeDiagnosticsReceipt = { reportId: "r-1", receivedAt: NOW };

function identity(overrides: Partial<InstanceIdentityView> = {}): InstanceIdentityView {
  return {
    instanceId: "inst-1",
    upgradeDiagnosticsOptOut: false,
    ...overrides,
  } as InstanceIdentityView;
}

function setup({
  identities = [identity()],
  availability = { available: true, reason: null, automatic: false },
  automaticDisabled = false,
}: {
  identities?: InstanceIdentityView[];
  availability?: OpsUpgradeDiagnosticsAvailability;
  automaticDisabled?: boolean;
} = {}) {
  const sent: { trigger: string; bundle: UpgradeDiagnosticsBundle }[] = [];
  const ledger = MemoryUpgradeLedgerRepository.create({
    reader: createApiFixture<UpgradeReader>({
      getStep: async ({ id }) => {
        if (id === "ops:done") return { ...stepOf({ id, status: "done" }), targets: [] };
        if (id !== "ops:backfill") return MemoryUpgradeLedgerRepository.create().getStep({ id });
        return { ...stepOf({ id, status: "failed", lastError: "boom" }), targets: [] };
      },
    }),
  });
  const service = UpgradeDiagnosticsService.create({
    ledger,
    licensing: createApiFixture<Licensing>({
      findInstanceIdentity: async () => identities,
      getUpgradeDiagnosticsAvailability: async () => availability,
      sendUpgradeDiagnostics: async ({ trigger, bundle }) => {
        sent.push({ trigger, bundle });
        return RECEIPT;
      },
      setUpgradeDiagnosticsOptOut: async ({ optOut }) => {
        identities.splice(0, 1, {
          ...(identities[0] ?? identity()),
          upgradeDiagnosticsOptOut: optOut,
        });
      },
    }),
    deployment: { imageRelease: "3.23.0", chartVersion: "1.4.2", installMethod: "helm" },
    automaticDisabled,
    now: () => NOW,
  });
  return { service, sent };
}

describe("UpgradeDiagnosticsService", () => {
  describe("when an operator switches automatic sending", () => {
    describe("given it was on", () => {
      it("records the opt-out, reads it back off, and the hourly check stops sending", async () => {
        const { service } = setup();
        expect(await service.getAutoSend()).toEqual({ enabled: true });

        expect(await service.setAutoSend({ enabled: false })).toEqual({ enabled: false });
        expect((await service.getAvailability()).automatic).toBe(false);
      });
    });

    describe("given the environment variable switched automatic sending off", () => {
      it("still reads the operator's own switch", async () => {
        const { service } = setup({ automaticDisabled: true });
        expect(await service.getAutoSend()).toEqual({ enabled: true });
      });
    });
  });

  describe("when getting a bundle", () => {
    describe("given the install has an identity", () => {
      it("carries the instance id with the deployment facts", async () => {
        const { service } = setup();
        const bundle = await service.getBundle({ id: "ops:backfill" });
        expect(bundle.step.id).toBe("ops:backfill");
        expect(bundle.generatedAt).toBe(NOW);
        expect(bundle.deployment).toEqual({
          imageRelease: "3.23.0",
          chartVersion: "1.4.2",
          installMethod: "helm",
          instanceId: "inst-1",
        });
      });
    });

    describe("given the install has no identity row", () => {
      it("carries a null instance id", async () => {
        const { service } = setup({ identities: [] });
        const bundle = await service.getBundle({ id: "ops:backfill" });
        expect(bundle.deployment.instanceId).toBeNull();
      });
    });

    describe("given no step with the id asked for", () => {
      /** @scenario "Diagnostics for an unknown step are refused by name" */
      it("refuses with upgrade_not_found", async () => {
        const { service } = setup();
        await expect(service.getBundle({ id: "nope" })).rejects.toMatchObject({
          code: "upgrade_not_found",
        });
      });
    });
  });

  describe("when reading availability", () => {
    describe("given Connect can receive diagnostics and nothing opts out", () => {
      it("is available and automatic", async () => {
        const { service } = setup();
        expect(await service.getAvailability()).toEqual({
          available: true,
          reason: null,
          automatic: true,
        });
      });
    });

    describe("given the automatic send is disabled by the environment", () => {
      /** @scenario "The install sends diagnostics by itself unless an operator switched it off" */
      it("is available but not automatic", async () => {
        const { service } = setup({ automaticDisabled: true });
        expect(await service.getAvailability()).toMatchObject({
          available: true,
          automatic: false,
        });
      });
    });

    describe("given the instance identity opted out", () => {
      it("is available but not automatic", async () => {
        const { service } = setup({ identities: [identity({ upgradeDiagnosticsOptOut: true })] });
        expect(await service.getAvailability()).toMatchObject({
          available: true,
          automatic: false,
        });
      });
    });

    describe("given Connect cannot receive diagnostics", () => {
      it("is neither available nor automatic, keeping the reason", async () => {
        const { service } = setup({
          availability: { available: false, reason: "no_licence", automatic: false },
        });
        expect(await service.getAvailability()).toEqual({
          available: false,
          reason: "no_licence",
          automatic: false,
        });
      });
    });
  });

  describe("when sending", () => {
    it("passes the trigger and the step's bundle to licensing and answers its receipt", async () => {
      const { service, sent } = setup();
      const receipt = await service.send({ id: "ops:backfill", trigger: "operator" });
      expect(receipt).toEqual(RECEIPT);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.trigger).toBe("operator");
      expect(sent[0]?.bundle.step.id).toBe("ops:backfill");
    });

    describe("given the bundle an operator reviewed", () => {
      /** @scenario "Send to LangWatch sends the bundle the operator reviewed" */
      it("sends that bundle unchanged as the operator's", async () => {
        const { service, sent } = setup();
        const reviewed = await service.getBundle({ id: "ops:backfill" });

        await service.sendReviewed({
          bundle: { ...reviewed, generatedAt: "2026-10-20T09:00:00Z" },
        });

        expect(sent).toEqual([
          { trigger: "operator", bundle: { ...reviewed, generatedAt: "2026-10-20T09:00:00Z" } },
        ]);
      });

      it("redacts a secret written into it before it leaves", async () => {
        const { service, sent } = setup();
        const reviewed = await service.getBundle({ id: "ops:backfill" });

        await service.sendReviewed({
          bundle: {
            ...reviewed,
            step: { ...reviewed.step, lastError: "dial postgres://app:hunter2@db:5432/lw" },
          },
        });

        expect(sent[0]?.bundle.step.lastError).not.toContain("hunter2");
      });

      it("sends nothing for a step that is not failed", async () => {
        const { service, sent } = setup();
        const reviewed = await service.getBundle({ id: "ops:backfill" });

        await expect(
          service.sendReviewed({
            bundle: { ...reviewed, step: { ...reviewed.step, id: "ops:done" } },
          }),
        ).rejects.toMatchObject({ code: "upgrade_step_not_failed" });
        expect(sent).toEqual([]);
      });

      it("sends nothing for a step the ledger does not know", async () => {
        const { service, sent } = setup();
        const reviewed = await service.getBundle({ id: "ops:backfill" });

        await expect(
          service.sendReviewed({ bundle: { ...reviewed, step: { ...reviewed.step, id: "nope" } } }),
        ).rejects.toMatchObject({ code: "upgrade_not_found" });
        expect(sent).toEqual([]);
      });
    });

    describe("given an unknown step", () => {
      it("sends nothing and refuses with upgrade_not_found", async () => {
        const { service, sent } = setup();
        await expect(service.send({ id: "nope", trigger: "automatic" })).rejects.toMatchObject({
          code: "upgrade_not_found",
        });
        expect(sent).toEqual([]);
      });
    });
  });
});
