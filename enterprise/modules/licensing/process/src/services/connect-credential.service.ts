/**
 * Resolves a license token to the managed gateway key it runs under (ADR-156):
 * the only reader of the registry on the credential path, never on the path of
 * validating a license inside an install. A refusal names a code and no more.
 */

import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import {
  entitledConnectServices,
  type ConnectCredentialRefusalCode,
  type ConnectService,
} from "@langwatch/enterprise-licensing-contract";
import { isLicenseTokenShape, registryHashForToken } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { statusOfIssuedLicense } from "../rules/issued-license.rules.ts";
import { isInstanceIdShape } from "../rules/license-token.rules.ts";
import type { ConnectManagedKeys } from "./license-registry.service.ts";

interface ConnectCredentialOptions {
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeys;
  cryptography: LicenseCryptography;
  /** Attributed as the actor when a provisioned key lost the attach and is ended. */
  systemActorId: string;
  now: () => Instant;
}

/**
 * What the feature learns internally: the row, so the sync can act on it. The
 * app narrows this to the portable grant before it leaves the module.
 */
export type ConnectCredentialOutcome =
  | {
      ok: true;
      license: IssuedLicenseRecord & { organizationId: string; instanceId: string };
      virtualKeyId: string;
    }
  | { ok: false; code: ConnectCredentialRefusalCode };

type ManagedKeyOutcome =
  | { ok: true; virtualKeyId: string }
  | { ok: false; code: ConnectCredentialRefusalCode };

export class ConnectCredentialService {
  static create(options: ConnectCredentialOptions): ConnectCredentialService {
    return new ConnectCredentialService(options);
  }

  private constructor(private readonly options: ConnectCredentialOptions) {}

  async resolve(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialOutcome> {
    if (!isLicenseTokenShape(input.token)) return refuse("connect_license_token_malformed");
    const instanceId = input.instanceId?.trim() ?? "";
    if (!isInstanceIdShape(instanceId)) return refuse("connect_instance_required");

    const row = await this.options.repository.findByTokenHash(
      await registryHashForToken(input.token),
    );
    // An unlinked license names no customer, so there is nothing to attribute a
    // call to. It reads the same as a license that was never recorded.
    if (!row?.organizationId) return refuse("connect_license_not_registered");

    const settled = this.refusalForStatus(row);
    if (settled) return refuse(settled);

    const boundTo = await this.boundInstance({ row, instanceId });
    if (boundTo !== instanceId) return refuse("connect_wrong_instance");

    const key = await this.managedKey({ row, organizationId: row.organizationId, instanceId });
    if (!key.ok) return refuse(key.code);
    // The gateway resolves the token by these facts alone, so they are rewritten
    // on every resolution: activation and each sync.
    await this.options.managedKeys.setLicense({
      virtualKeyId: key.virtualKeyId,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      instanceId,
      expiresAt: row.expiresAt,
    });
    return {
      ok: true,
      license: { ...row, organizationId: row.organizationId, instanceId },
      virtualKeyId: key.virtualKeyId,
    };
  }

  /** What the active license behind one managed key is entitled to; empty
   *  where none is, so the gateway never reads the registry itself. */
  async findEntitledServices(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<ConnectService[]> {
    const row = await this.options.repository.findByVirtualKeyId(input.virtualKeyId);
    if (!row || row.organizationId !== input.organizationId) return [];
    if (statusOfIssuedLicense(row, this.options.now()) !== "active") return [];

    return entitledConnectServices(row.services);
  }

  /** The instance the license is bound to once this call had its chance to bind it. */
  private async boundInstance({
    row,
    instanceId,
  }: {
    row: IssuedLicenseRecord;
    instanceId: string;
  }): Promise<string | null> {
    if (row.instanceId) return row.instanceId;
    const bound = await this.options.repository.bindInstance({
      id: row.id,
      instanceId,
      at: this.options.now(),
    });
    if (bound) return instanceId;
    // Another install bound it between the read and the write.
    const current = await this.options.repository.findById(row.id);
    return current?.instanceId ?? null;
  }

  /**
   * The license's managed key. Without one, gateway is asked to provision it
   * (C3B-ORDER) and the call is told to retry; the key arrives seconds later.
   */
  private async managedKey({
    row,
    organizationId,
    instanceId,
  }: {
    row: IssuedLicenseRecord;
    organizationId: string;
    instanceId: string;
  }): Promise<ManagedKeyOutcome> {
    if (row.virtualKeyId) return { ok: true, virtualKeyId: row.virtualKeyId };

    await this.options.managedKeys.issue({
      organizationId,
      licenseId: row.licenseId,
      issuedLicenseId: row.id,
      instanceId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      services: entitledConnectServices(row.services),
    });
    return { ok: false, code: "connect_credential_pending" };
  }

  /**
   * Gateway's answer to an issued fact. The attach admits the key only while the
   * row has none and is this install's active license; a key that lost is ended,
   * and the attached key is never ended here. Safe to repeat.
   */
  async attachProvisioned({
    issuedLicenseId,
    organizationId,
    virtualKeyId,
  }: {
    issuedLicenseId: string;
    organizationId: string;
    virtualKeyId: string;
  }): Promise<void> {
    const row = await this.options.repository.findById(issuedLicenseId);
    if (row?.virtualKeyId === virtualKeyId) return;
    const attached =
      row?.organizationId === organizationId && row.instanceId !== null
        ? await this.options.repository.attachVirtualKey({
            id: row.id,
            virtualKeyId,
            requires: { organizationId, instanceId: row.instanceId, activeAt: this.options.now() },
          })
        : false;
    if (attached) return;
    const current = await this.options.repository.findById(issuedLicenseId);
    if (current?.virtualKeyId === virtualKeyId) return;
    await this.retire({ virtualKeyId, organizationId });
  }

  /** Why the license as stored now admits no call, or null when it does. */
  private refusalForStatus(row: IssuedLicenseRecord): ConnectCredentialRefusalCode | null {
    const status = statusOfIssuedLicense(row, this.options.now());
    if (status === "revoked" || status === "superseded") return "connect_license_revoked";
    if (status === "expired") return "connect_license_expired";
    return null;
  }

  private async retire({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<void> {
    await this.options.managedKeys.retire({
      virtualKeyId,
      organizationId,
      actorId: this.options.systemActorId,
    });
  }
}

function refuse(code: ConnectCredentialRefusalCode): ConnectCredentialOutcome {
  return { ok: false, code };
}
