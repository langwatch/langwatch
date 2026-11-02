// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The install end of upgrade diagnostics: one redacted bundle to the licence host, with the
 * credential a licence sync presents. Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
import {
  ConnectDisabledError,
  UpgradeDiagnosticsLicenseRequiredError,
  type UpgradeDiagnosticsAvailability,
  type UpgradeDiagnosticsReceipt,
  type UpgradeDiagnosticsSubmission,
} from "@langwatch/enterprise-licensing-contract";

import type { ConnectLicenseChannel } from "../channels/connect-license.channel.ts";
import type { ConnectInstallService } from "./connect-install.service.ts";

type UpgradeDiagnosticsSenderDependencies = Readonly<{
  install: Pick<ConnectInstallService, "findInstallCredential" | "holdsInstallLicence">;
  /** Absent where the deployment switched Connect off: nothing is called. */
  host?: ConnectLicenseChannel;
}>;

export class UpgradeDiagnosticsSenderService {
  static create(deps: UpgradeDiagnosticsSenderDependencies): UpgradeDiagnosticsSenderService {
    return new UpgradeDiagnosticsSenderService(deps);
  }

  private constructor(private readonly deps: UpgradeDiagnosticsSenderDependencies) {}

  /** Reads only: the instance id is minted by `send`, not by asking whether one could be. */
  async availability(): Promise<UpgradeDiagnosticsAvailability> {
    if (!this.deps.host) return { available: false, reason: "connect_disabled" };
    if (!(await this.deps.install.holdsInstallLicence())) {
      return { available: false, reason: "no_licence" };
    }
    return { available: true, reason: null };
  }

  async send(submission: UpgradeDiagnosticsSubmission): Promise<UpgradeDiagnosticsReceipt> {
    const host = this.deps.host;
    if (!host) throw new ConnectDisabledError();
    const [credential] = await this.deps.install.findInstallCredential();
    if (!credential) throw new UpgradeDiagnosticsLicenseRequiredError();
    return host.sendUpgradeDiagnostics({ credential, submission });
  }
}
