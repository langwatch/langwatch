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
  entitledConnectServices,
  LicenseSyncPayloadInvalidError,
  LicenseSyncRateLimitedError,
  licenseSyncBodySchema,
  type LicenseSyncRefusalCode,
  type ConnectPresentedCredential,
  type LicenseSyncAnswer,
  type LicenseSyncBody,
  type LicenseSyncResult,
} from "@langwatch/enterprise-licensing-contract";
import type { HandledError } from "@langwatch/handled-error";
import type { Instant } from "@langwatch/time";

import type {
  ConnectManagedKeys,
  LicenseDeliveryCipher,
  LicenseSyncRateLimit,
} from "../app/licensing.members.ts";
import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { bearerTokenOf } from "../rules/connect-presented-credential.rules.ts";
import type { ConnectCredentialOutcome } from "./connect-credential.service.ts";

/** The credential service, as the sync uses it. It binds the instance on first use. */
export interface ConnectCredentialResolver {
  resolve(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialOutcome>;
}

export interface LicenseSyncOptions {
  credentials: ConnectCredentialResolver;
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeys;
  rateLimit: LicenseSyncRateLimit;
  cipher: LicenseDeliveryCipher;
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
  validation_error: () => new LicenseSyncPayloadInvalidError(),
  rate_limited: () => new LicenseSyncRateLimitedError(),
};

export class LicenseSyncService {
  static create(options: LicenseSyncOptions): LicenseSyncService {
    return new LicenseSyncService(options);
  }

  private constructor(private readonly options: LicenseSyncOptions) {}

  /** The connect host's answer to one presented sync; a refusal throws its code. */
  async answer(input: ConnectPresentedCredential & { body: unknown }): Promise<LicenseSyncAnswer> {
    const result = await this.recordSync({
      token: bearerTokenOf(input.authorization),
      instanceId: input.instanceId,
      body: input.body,
    });
    if (!result.ok) throw SYNC_REFUSALS[result.code]();
    return { services: result.services, ...(result.license ? { license: result.license } : {}) };
  }

  async recordSync(input: {
    token: string;
    instanceId: string | null | undefined;
    body: unknown;
  }): Promise<LicenseSyncResult> {
    const parsed = licenseSyncBodySchema.safeParse(input.body);
    if (!parsed.success) return { ok: false, code: "validation_error" };

    const resolution = await this.options.credentials.resolve({
      token: input.token,
      instanceId: input.instanceId,
    });
    if (!resolution.ok) return { ok: false, code: resolution.code };

    const row = resolution.license;
    if (!(await this.options.rateLimit.allow({ licenseRowId: row.id }))) {
      return { ok: false, code: "rate_limited" };
    }

    await this.record({ row, seats: parsed.data.seats, version: parsed.data.version });
    await this.options.managedKeys.setConnectServices({
      virtualKeyId: resolution.virtualKeyId,
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
   * the held copy is erased and what it replaced is retired, key first.
   */
  private async completeDelivery(row: IssuedLicenseRecord): Promise<void> {
    if (!row.replacesId || !row.pendingDeliveryLicense) return;
    const replaced = await this.options.repository.findById(row.replacesId);
    if (replaced?.virtualKeyId && replaced.organizationId) {
      await this.options.managedKeys.retire({
        virtualKeyId: replaced.virtualKeyId,
        organizationId: replaced.organizationId,
        actorId: this.options.systemActorId,
      });
    }
    if (replaced && !replaced.supersededAt) {
      await this.options.repository.update(replaced.id, { supersededAt: this.options.now() });
    }
    await this.options.repository.update(row.id, { pendingDeliveryLicense: null });
  }

  /** The reissued license waiting for this install, decrypted, or nothing. */
  private async pendingDelivery(row: IssuedLicenseRecord): Promise<string | undefined> {
    const replacement = await this.options.repository.findByReplacesId(row.id);
    if (!replacement?.pendingDeliveryLicense) return undefined;
    return this.options.cipher.decrypt(replacement.pendingDeliveryLicense);
  }
}
