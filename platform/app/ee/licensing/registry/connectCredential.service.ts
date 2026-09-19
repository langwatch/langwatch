/**
 * Resolves a license token to the managed gateway key it runs under (ADR-139).
 *
 * This is the only reader of the registry on the credential path. It runs on
 * LangWatch Cloud when the gateway asks who a `lwl_` bearer is. It is never on
 * the path of validating a license inside an install.
 *
 * Every refusal has a stable code and a message that says nothing about the
 * customer, the seats or the term: the caller may be holding a token it should
 * not have.
 */

import { isLicenseTokenShape, registryHashForToken } from "../licenseToken";
import {
  type ConnectManagedKeyPort,
  type IssuedLicenseRecord,
  type IssuedLicenseRepository,
  statusOfIssuedLicense,
} from "./licenseRegistry.service";

export const CONNECT_CREDENTIAL_REFUSALS = {
  connect_license_token_malformed: {
    status: 401,
    message: "the license token is malformed",
  },
  connect_instance_required: {
    status: 400,
    message: "a license token must be presented with an instance id",
  },
  connect_license_not_registered: {
    status: 401,
    message: "this license is not registered for hosted services",
  },
  connect_license_revoked: {
    status: 403,
    message: "this license is no longer active",
  },
  connect_license_expired: {
    status: 403,
    message: "this license has expired",
  },
  connect_wrong_instance: {
    status: 403,
    message: "this license is bound to another instance",
  },
} as const;

export type ConnectCredentialRefusalCode =
  keyof typeof CONNECT_CREDENTIAL_REFUSALS;

export type ConnectCredentialResolution =
  | {
      ok: true;
      /** Bound to a customer and to the install that presented it. */
      license: IssuedLicenseRecord & {
        organizationId: string;
        instanceId: string;
      };
      virtualKeyId: string;
    }
  | { ok: false; code: ConnectCredentialRefusalCode };

/** What an install may send as its instance id: a UUID fits, a payload does not. */
const INSTANCE_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ConnectCredentialDependencies {
  repository: IssuedLicenseRepository;
  managedKeys: ConnectManagedKeyPort;
  /** Attributed as the actor when a managed key lost the race and is ended. */
  systemActorId: string;
  now?: () => Date;
}

export class ConnectCredentialService {
  private readonly now: () => Date;

  constructor(private readonly deps: ConnectCredentialDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async resolve(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialResolution> {
    if (!isLicenseTokenShape(input.token)) {
      return refuse("connect_license_token_malformed");
    }
    const instanceId = input.instanceId?.trim() ?? "";
    if (!INSTANCE_ID_SHAPE.test(instanceId)) {
      return refuse("connect_instance_required");
    }

    const row = await this.deps.repository.findByTokenHash(
      registryHashForToken(input.token),
    );
    // An unlinked license names no customer, so there is nothing to attribute
    // a call to. It reads the same as a license that was never recorded.
    if (!row?.organizationId) return refuse("connect_license_not_registered");

    const status = statusOfIssuedLicense(row, this.now());
    if (status === "revoked" || status === "superseded") {
      return refuse("connect_license_revoked");
    }
    if (status === "expired") return refuse("connect_license_expired");

    const boundTo = await this.boundInstance({ row, instanceId });
    if (boundTo !== instanceId) return refuse("connect_wrong_instance");

    const virtualKeyId = await this.managedKey({
      row,
      organizationId: row.organizationId,
    });
    return {
      ok: true,
      license: { ...row, organizationId: row.organizationId, instanceId },
      virtualKeyId,
    };
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
    const bound = await this.deps.repository.bindInstance({
      id: row.id,
      instanceId,
      at: this.now(),
    });
    if (bound) return instanceId;
    // Another install bound it between the read and the write.
    const current = await this.deps.repository.findById(row.id);
    return current?.instanceId ?? null;
  }

  /** The license's managed key, created on first use. */
  private async managedKey({
    row,
    organizationId,
  }: {
    row: IssuedLicenseRecord;
    organizationId: string;
  }): Promise<string> {
    if (row.virtualKeyId) return row.virtualKeyId;

    const created = await this.deps.managedKeys.provision({
      organizationId,
      licenseId: row.licenseId,
    });
    const attached = await this.deps.repository.attachVirtualKey({
      id: row.id,
      virtualKeyId: created.id,
    });
    if (attached) return created.id;

    // A concurrent first call attached its key first. One key per license is
    // what lets a spend row name the install, so the extra one is ended.
    await this.deps.managedKeys.retire({
      virtualKeyId: created.id,
      organizationId,
      actorId: this.deps.systemActorId,
    });
    const current = await this.deps.repository.findById(row.id);
    if (!current?.virtualKeyId) {
      throw new Error(
        `license ${row.id} has no managed key after a lost attach race`,
      );
    }
    return current.virtualKeyId;
  }
}

function refuse(
  code: ConnectCredentialRefusalCode,
): ConnectCredentialResolution {
  return { ok: false, code };
}
