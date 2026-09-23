/**
 * The install end of the license sync (ADR-156, section 6): the token, the
 * instance id, the version and the two seat counts, and nothing else.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import {
  type LicenseError,
  type LicenseRefreshOutcome,
  type LicenseSyncOutcome,
  ConnectDisabledError,
  ConnectLicenseRequiredError,
  licenseValidationError,
} from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import type { LicenseCryptography } from "../app/licensing.members.ts";
import type { ConnectLicenseChannel } from "../channels/connect-license.channel.ts";
import type { ConnectOrganizationRepository } from "../repositories/connect-organization.repository.ts";
import type { ConnectInstallService } from "./connect-install.service.ts";

/** The seats in use, counted the way the seat guard counts them. */
export interface LicenseSeatCounter {
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
}

/** Applying a delivered license goes through the same path a pasted key does. */
export interface LicenseApplication {
  validateAndStoreLicense(input: {
    organizationId: string;
    licenseKey: string;
  }): Promise<
    { success: true; planInfo: { maxMembers: number } } | { success: false; error: LicenseError }
  >;
}

export interface LicenseRefreshServiceDependencies {
  readonly install: ConnectInstallService;
  readonly organizations: ConnectOrganizationRepository;
  readonly seats: LicenseSeatCounter;
  readonly licenses: LicenseApplication;
  readonly cryptography: LicenseCryptography;
  /** Absent where the deployment switched Connect off: nothing is called. */
  readonly host?: ConnectLicenseChannel;
  /** This install's own identity, which an activation code is redeemed for. */
  readonly instanceId: () => Promise<string>;
  /** The release this install runs, as the report names it. */
  readonly version: () => string;
  readonly now: () => Instant;
  readonly logger?: { warn(fields: Record<string, unknown>, message: string): void };
}

export class LicenseRefreshService {
  static create(deps: LicenseRefreshServiceDependencies): LicenseRefreshService {
    return new LicenseRefreshService(deps);
  }

  private constructor(private readonly deps: LicenseRefreshServiceDependencies) {}

  /**
   * One pass over the organizations whose license names a hosted service. A
   * license that names none is not synced, which is how an install on an
   * offline license makes no call.
   */
  async syncAll(organizationIds: readonly string[]): Promise<void> {
    if (!this.deps.host) return;

    for (const organizationId of organizationIds) {
      const entitled = await this.deps.install.findEntitledServices(organizationId);
      if (entitled.length === 0) continue;

      try {
        await this.syncOne(organizationId);
        await this.record({ organizationId, error: null });
      } catch (error) {
        await this.recordFailure({ organizationId, error });
      }
    }
  }

  /**
   * The sync an administrator asks for, so a seat change reaches this install
   * now rather than on the next daily pass. A refusal is recorded the way the
   * daily pass records one, then thrown as the code the host named.
   */
  async refresh(organizationId: string): Promise<LicenseRefreshOutcome> {
    const host = this.deps.host;
    if (!host) throw new ConnectDisabledError();

    const entitled = await this.deps.install.findEntitledServices(organizationId);
    if (entitled.length === 0) throw new ConnectLicenseRequiredError();

    let synced: LicenseSyncOutcome;
    try {
      synced = await this.syncOne(organizationId);
    } catch (error) {
      await this.recordFailure({ organizationId, error });
      throw error;
    }

    if (synced.outcome === "delivered_invalid") {
      await this.record({ organizationId, error: "license_key_invalid" });
      throw licenseValidationError(synced.error);
    }
    await this.record({ organizationId, error: null });
    return synced;
  }

  /**
   * Redeems an activation code for the license it mints. The code is the
   * credential for this one call and is never stored; what comes back is an
   * ordinary signed license, validated and stored like a pasted one.
   */
  async redeemActivationCode({ code }: { code: string }): Promise<{ licenseKey: string }> {
    const host = this.deps.host;
    if (!host) throw new ConnectDisabledError();
    const answer = await host.activate({ code, instanceId: await this.deps.instanceId() });
    return { licenseKey: answer.license };
  }

  private async syncOne(organizationId: string): Promise<LicenseSyncOutcome> {
    const host = this.deps.host;
    if (!host) return { outcome: "unchanged" };

    const [credential] = await this.deps.install.findCredential(organizationId);
    if (!credential) return { outcome: "unchanged" };

    const answer = await host.syncLicense({
      credential,
      version: this.deps.version(),
      seats: await this.countSeats(organizationId),
    });
    if (!answer.license) return { outcome: "unchanged" };

    return this.deliver({ organizationId, license: answer.license });
  }

  private async countSeats(
    organizationId: string,
  ): Promise<{ members: number; liteMembers: number }> {
    const [members, liteMembers] = await Promise.all([
      this.deps.seats.getMemberCount(organizationId),
      this.deps.seats.getMembersLiteCount(organizationId),
    ]);
    return { members, liteMembers };
  }

  /**
   * A reissued license the answer carried, through the same validate-and-store
   * path a pasted key takes. One more sync with the new token is what tells the
   * registry the replaced license is out of use.
   */
  private async deliver({
    organizationId,
    license,
  }: {
    organizationId: string;
    license: string;
  }): Promise<LicenseSyncOutcome> {
    const stored = await this.deps.licenses.validateAndStoreLicense({
      organizationId,
      licenseKey: license,
    });
    if (!stored.success) return { outcome: "delivered_invalid", error: stored.error };

    const [renewed] = await this.deps.install.findCredential(organizationId);
    if (renewed && this.deps.host) {
      await this.deps.host.syncLicense({
        credential: renewed,
        version: this.deps.version(),
        seats: await this.countSeats(organizationId),
      });
    }

    return {
      outcome: "updated",
      maxMembers: stored.planInfo.maxMembers,
      expiresAt: this.deps.cryptography.parseLicenseKey(license)?.data.expiresAt ?? "",
    };
  }

  private async record({
    organizationId,
    error,
  }: {
    organizationId: string;
    error: string | null;
  }): Promise<void> {
    await this.deps.organizations.recordSyncOutcome({
      organizationId,
      at: this.deps.now(),
      error,
    });
  }

  /** A failed sync names its code, so Settings shows what to fix. */
  private async recordFailure({
    organizationId,
    error,
  }: {
    organizationId: string;
    error: unknown;
  }): Promise<void> {
    const code = HandledError.isHandled(error) ? error.code : "license_sync_failed";
    this.deps.logger?.warn({ organizationId, code }, "license sync failed");
    await this.record({ organizationId, error: code }).catch(() => void 0);
  }
}
