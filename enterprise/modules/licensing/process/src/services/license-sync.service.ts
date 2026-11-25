/**
 * The control plane end of a license sync (ADR-156, section 6): the install
 * reports its version and its seats, and gets back its entitled services and
 * any license waiting to replace the one it holds. A refusal records nothing.
 */

import {
  ConnectInstanceRequiredError,
  ConnectLicenseExpiredError,
  ConnectLicenseNotRegisteredError,
  ConnectLicenseRevokedError,
  ConnectLicenseTokenMalformedError,
  ConnectWrongInstanceError,
  ConnectCredentialPendingError,
  entitledConnectServices,
  LicenseSyncPayloadInvalidError,
  LicenseSyncRateLimitedError,
  licenseSyncBodySchema,
  type LicenseSyncRefusalCode,
  type ConnectLicenceCaller,
  type ConnectPresentedCredential,
  type LicenseSyncAnswer,
  type LicenseSyncBody,
  type LicenseSyncResult,
} from "@langwatch/enterprise-licensing-contract";
import type { HandledError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import type {
  ConnectCredentialOutcome,
  RenewalCollectOutcome,
} from "./connect-credential.service.ts";
import type { ConnectManagedKeys } from "./license-registry.service.ts";

/** The credential service, as the sync uses it. It binds the instance on first use. */
interface ConnectCredentialResolver {
  resolve(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialOutcome>;
  resolveRenewalCollect(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<RenewalCollectOutcome>;
}

interface LicenseSyncOptions {
  credentials: ConnectCredentialResolver;
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeys;
  rateLimit: LicenseSyncRateLimit;
  /** Attributed as the actor when a replaced license's managed key is ended. */
  systemActorId: string;
  now: () => Instant;
}

/** The named error behind each refusal code a sync can end in, the gateway's codes included. */
const SYNC_REFUSALS: Record<LicenseSyncRefusalCode, () => HandledError> = {
  connect_license_token_malformed: () => new ConnectLicenseTokenMalformedError(),
  connect_instance_required: () => new ConnectInstanceRequiredError(),
  connect_license_not_registered: () => new ConnectLicenseNotRegisteredError(),
  connect_license_revoked: () => new ConnectLicenseRevokedError(),
  connect_license_expired: () => new ConnectLicenseExpiredError(),
  connect_wrong_instance: () => new ConnectWrongInstanceError(),
  connect_credential_pending: () => new ConnectCredentialPendingError(),
  validation_error: () => new LicenseSyncPayloadInvalidError(),
  rate_limited: () => new LicenseSyncRateLimitedError(),
};

/** How far a chain walk goes before it stops: a guard against a cycle in bad data. */
const MAX_CHAIN = 100;
/** Walks of the chain a sync makes before it gives up on a pick that keeps being retired. */
const MAX_PICK_ATTEMPTS = 3;

export class LicenseSyncService {
  static create(options: LicenseSyncOptions): LicenseSyncService {
    return new LicenseSyncService(options);
  }

  private constructor(private readonly options: LicenseSyncOptions) {}

  /** The `licence_token` door's check: who presented this bearer, or its refusal thrown. */
  async verify(input: ConnectPresentedCredential): Promise<ConnectLicenceCaller> {
    const resolution = await this.options.credentials.resolve({
      token: input.bearer ?? "",
      instanceId: input.instanceId,
    });
    if (!resolution.ok) throw SYNC_REFUSALS[resolution.code]();
    return callerOf(resolution);
  }

  /**
   * The sync door's check: `verify`, except that an expired license with a renewal
   * waiting for it is admitted to collect that renewal and nothing more.
   */
  async verifyForSync(input: ConnectPresentedCredential): Promise<ConnectLicenceCaller> {
    const presented = { token: input.bearer ?? "", instanceId: input.instanceId };
    const resolution = await this.options.credentials.resolve(presented);
    if (resolution.ok) return callerOf(resolution);
    if (resolution.code !== "connect_license_expired") throw SYNC_REFUSALS[resolution.code]();

    const renewal = await this.options.credentials.resolveRenewalCollect(presented);
    if (!renewal.ok) throw SYNC_REFUSALS[renewal.code]();
    return {
      licenseRowId: renewal.license.id,
      organizationId: renewal.license.organizationId,
      instanceId: renewal.license.instanceId,
      virtualKeyId: null,
      renewalOnly: true,
    };
  }

  /** The connect host's answer to one verified sync; a refusal throws its code. */
  async answer(input: { caller: ConnectLicenceCaller; body: unknown }): Promise<LicenseSyncAnswer> {
    const result = await this.recordSync(input);
    if (!result.ok) throw SYNC_REFUSALS[result.code]();
    return { services: result.services, ...(result.license ? { license: result.license } : {}) };
  }

  async recordSync(input: {
    caller: ConnectLicenceCaller;
    body: unknown;
  }): Promise<LicenseSyncResult> {
    const parsed = licenseSyncBodySchema.safeParse(input.body);
    if (!parsed.success) return { ok: false, code: "validation_error" };

    const row = await this.options.repository.findById(input.caller.licenseRowId);
    if (!row?.organizationId) return { ok: false, code: "connect_license_not_registered" };
    if (!(await this.options.rateLimit.allow({ licenseRowId: row.id }))) {
      return { ok: false, code: "rate_limited" };
    }
    if (input.caller.renewalOnly || input.caller.virtualKeyId === null) {
      const license = await this.pendingDelivery(row);
      if (!license) return { ok: false, code: "connect_license_expired" };
      return { ok: true, services: [], license };
    }

    await this.record({ row, seats: parsed.data.seats, version: parsed.data.version });
    await this.options.managedKeys.setConnectServices({
      virtualKeyId: input.caller.virtualKeyId,
      organizationId: row.organizationId,
      services: entitledConnectServices(row.services),
    });
    await this.completeDelivery(row);
    const license = await this.pendingDelivery(row);

    return {
      ok: true,
      services: entitledConnectServices(row.services),
      ...(license ? { license } : {}),
    };
  }

  /** The last report on the row: when, from which version, and the seats in use. */
  private async record({
    row,
    seats,
    version,
  }: {
    row: IssuedLicenseRecord;
    seats: LicenseSyncBody["seats"];
    version: string;
  }): Promise<void> {
    await this.options.repository.update(row.id, {
      lastSyncAt: this.options.now(),
      lastSyncVersion: version,
      reportedMembers: seats.members,
      reportedMembersLite: seats.liteMembers,
    });
  }

  /**
   * Presenting a license that was held for delivery proves the install has it:
   * the held copy is erased and every license before it in the chain is
   * retired, key first, including a replacement the install skipped.
   */
  private async completeDelivery(row: IssuedLicenseRecord): Promise<void> {
    if (!row.replacesId || !row.pendingDeliveryLicense) return;
    let replacesId: string | null = row.replacesId;
    for (let step = 0; replacesId && step < MAX_CHAIN; step++) {
      const replaced = await this.options.repository.findById(replacesId);
      if (!replaced) break;
      await this.retire(replaced);
      replacesId = replaced.replacesId;
    }
    await this.options.repository.update(row.id, { pendingDeliveryLicense: null });
  }

  /** Retires one license the install moved past: its key, its held copy, then the row. */
  private async retire(replaced: IssuedLicenseRecord): Promise<void> {
    if (replaced.virtualKeyId && replaced.organizationId) {
      await this.options.managedKeys.retire({
        virtualKeyId: replaced.virtualKeyId,
        organizationId: replaced.organizationId,
        actorId: this.options.systemActorId,
      });
    }
    if (replaced.supersededAt && !replaced.pendingDeliveryLicense) return;
    await this.options.repository.update(replaced.id, {
      supersededAt: replaced.supersededAt ?? this.options.now(),
      pendingDeliveryLicense: null,
    });
  }

  /**
   * The newest license waiting for this install, or nothing; the walk goes to
   * the chain's end. A delivery completing meanwhile can retire the pick, so
   * it is read again and the walk repeated when it no longer waits.
   */
  private async pendingDelivery(row: IssuedLicenseRecord): Promise<string | undefined> {
    for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
      const picked = await this.newestHeld(row);
      if (!picked) return undefined;
      const fresh = await this.options.repository.findById(picked.id);
      if (fresh && stillWaiting(fresh) && fresh.pendingDeliveryLicense === picked.license) {
        return picked.license;
      }
    }
    return undefined;
  }

  private async newestHeld(
    row: IssuedLicenseRecord,
  ): Promise<{ id: string; license: string } | undefined> {
    let held: { id: string; license: string } | undefined;
    let replacement = await this.options.repository.findByReplacesId(row.id);
    for (let step = 0; replacement && step < MAX_CHAIN; step++) {
      if (replacement.pendingDeliveryLicense && stillWaiting(replacement)) {
        held = { id: replacement.id, license: replacement.pendingDeliveryLicense };
      }
      replacement = await this.options.repository.findByReplacesId(replacement.id);
    }
    return held;
  }
}

/** A held copy is still deliverable while its row is neither revoked nor retired. */
const stillWaiting = (row: IssuedLicenseRecord): boolean =>
  row.revokedAt === null && row.supersededAt === null;

function callerOf(
  resolution: Extract<ConnectCredentialOutcome, { ok: true }>,
): ConnectLicenceCaller {
  const { license, virtualKeyId } = resolution;
  return {
    licenseRowId: license.id,
    organizationId: license.organizationId,
    instanceId: license.instanceId,
    virtualKeyId,
  };
}

/** Whether this license may sync again now (48 calls per license per day). */
export interface LicenseSyncRateLimit {
  allow(params: { licenseRowId: string }): Promise<boolean>;
}
