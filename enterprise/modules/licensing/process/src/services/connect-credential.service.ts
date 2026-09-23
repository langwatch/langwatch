/**
 * Resolves a license token to the managed gateway key it runs under (ADR-156):
 * the only reader of the registry on the credential path, never on the path of
 * validating a license inside an install. A refusal names a code and no more.
 */

import {
  entitledConnectServices,
  type ConnectCredentialRefusalCode,
  type ConnectService,
} from "@langwatch/enterprise-licensing-contract";
import { isLicenseTokenShape, registryHashForToken } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

import type { ConnectManagedKeys, LicenseCryptography } from "../app/licensing.members.ts";
import type {
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../repositories/issued-license.repository.ts";
import { statusOfIssuedLicense } from "../rules/issued-license.rules.ts";
import { isInstanceIdShape } from "../rules/license-token.rules.ts";

export interface ConnectCredentialOptions {
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeys;
  cryptography: LicenseCryptography;
  /** Attributed as the actor when a managed key lost the race and is ended. */
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
   * The license's managed key, created on first use. The status check in
   * `resolve` ran before this key existed, so the attach carries that state
   * into the write instead, and a lost write never returns a key.
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

    const created = await this.options.managedKeys.provision({
      organizationId,
      licenseId: row.licenseId,
    });
    let attached: boolean;
    try {
      attached = await this.options.repository.attachVirtualKey({
        id: row.id,
        virtualKeyId: created.id,
        requires: { organizationId, instanceId, activeAt: this.options.now() },
      });
    } catch (error) {
      await this.retire({ virtualKeyId: created.id, organizationId });
      throw error;
    }
    if (attached) {
      await this.options.managedKeys.setConnectServices({
        virtualKeyId: created.id,
        organizationId,
        services: entitledConnectServices(row.services),
      });
      return { ok: true, virtualKeyId: created.id };
    }

    // This key authenticated nothing, so it is ended either way: a concurrent
    // first call attached its own, or the license stopped being this install's
    // active license. One key per license is what lets a spend row name it.
    await this.retire({ virtualKeyId: created.id, organizationId });
    return this.afterLostAttach({ id: row.id, organizationId, instanceId });
  }

  private async afterLostAttach({
    id,
    organizationId,
    instanceId,
  }: {
    id: string;
    organizationId: string;
    instanceId: string;
  }): Promise<ManagedKeyOutcome> {
    const current = await this.options.repository.findById(id);
    if (!current) return { ok: false, code: "connect_license_not_registered" };
    if (current.organizationId !== organizationId) {
      return { ok: false, code: "connect_license_not_registered" };
    }
    const settled = this.refusalForStatus(current);
    if (settled) return { ok: false, code: settled };
    if (current.instanceId !== instanceId) return { ok: false, code: "connect_wrong_instance" };
    if (!current.virtualKeyId) {
      throw new Error(`license ${id} has no managed key after a lost attach race`);
    }
    return { ok: true, virtualKeyId: current.virtualKeyId };
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
