import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type {
  OpsUpgradeDiagnosticsAvailability,
  OpsUpgradeDiagnosticsReceipt,
  UpgradeDiagnosticsBundle,
} from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import type { UpgradeLedgerRepository } from "#repositories/upgrade-ledger.repository";

import {
  type DiagnosticsDeployment,
  upgradeDiagnosticsOf,
} from "../rules/upgrade-diagnostics.rules.ts";

type Licensing = Pick<
  LicensingApi,
  "findInstanceIdentity" | "getUpgradeDiagnosticsAvailability" | "sendUpgradeDiagnostics"
>;

/**
 * A failed upgrade step's diagnostics for the LangWatch team, built and redacted on this install,
 * sent over Connect by an operator or by the hourly check. Spec: upgrade-diagnostics.feature
 */
export class UpgradeDiagnosticsService {
  static create(input: {
    ledger: Pick<UpgradeLedgerRepository, "getStep">;
    licensing: Licensing;
    deployment: Omit<DiagnosticsDeployment, "instanceId">;
    /** `DISABLE_UPGRADE_DIAGNOSTICS_AUTO_SEND`: the hourly check sends nothing by itself. */
    automaticDisabled: boolean;
    now?: () => string;
  }): UpgradeDiagnosticsService {
    return new UpgradeDiagnosticsService(input);
  }

  private constructor(
    private readonly deps: Parameters<typeof UpgradeDiagnosticsService.create>[0],
  ) {}

  /** The bundle as it would be sent; an unknown step is refused as `upgrade_not_found`. */
  async getBundle({ id }: { id: string }): Promise<UpgradeDiagnosticsBundle> {
    const [step, [identity]] = await Promise.all([
      this.deps.ledger.getStep({ id }),
      this.deps.licensing.findInstanceIdentity(),
    ]);
    return upgradeDiagnosticsOf({
      step,
      deployment: { ...this.deps.deployment, instanceId: identity?.instanceId ?? null },
      generatedAt: this.deps.now?.() ?? nowInstant().toString(),
    });
  }

  async getAvailability(): Promise<OpsUpgradeDiagnosticsAvailability> {
    const [availability, [identity]] = await Promise.all([
      this.deps.licensing.getUpgradeDiagnosticsAvailability(),
      this.deps.licensing.findInstanceIdentity(),
    ]);
    const optedOut = this.deps.automaticDisabled || (identity?.upgradeDiagnosticsOptOut ?? false);
    return { ...availability, automatic: availability.available && !optedOut };
  }

  /** Sends the step's bundle; licensing refuses by name where Connect is unavailable. */
  async send({
    id,
    trigger,
  }: {
    id: string;
    trigger: "operator" | "automatic";
  }): Promise<OpsUpgradeDiagnosticsReceipt> {
    const bundle = await this.getBundle({ id });
    return this.deps.licensing.sendUpgradeDiagnostics({ trigger, bundle });
  }
}
