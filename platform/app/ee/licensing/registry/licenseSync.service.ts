/**
 * The control plane end of a license sync (ADR-139, section 6).
 *
 * A connected install posts its version and its two seat counts once a day and
 * gets a signed lease back. The lease is what lets it go over its licensed
 * seats by the agreed allowance, and it expires, so an install that stops
 * syncing falls back to the hard cap on dates LangWatch signed.
 *
 * The same call is how a reissued license reaches an install: the replacement
 * is held encrypted on the registry until the install presents it, and
 * presenting it is what retires the license it replaced.
 *
 * Refusals use the codes the gateway already uses, because one piece of copy
 * covers both hosts. A refused sync records nothing.
 */

import { z } from "zod";
import { issueLease, type SignedLease } from "../connect/lease";
import { CONNECT_SERVICES, type ConnectService } from "../connect/services";
import {
  CONNECT_CREDENTIAL_REFUSALS,
  type ConnectCredentialResolution,
} from "./connectCredential.service";
import { LicenseSigningNotConfiguredError } from "./errors";
import {
  type ConnectManagedKeyPort,
  defaultSeatOverageAllowance,
  type IssuedLicenseRecord,
  type IssuedLicenseRepository,
} from "./issuedLicense";
import {
  type LicenseSeatReportRepository,
  licenseTermQuarterStart,
} from "./seatReports";

/**
 * Exactly what a sync may carry: the version and the two seat counts. No
 * organization name, no hostname, no user data and no statistics, and
 * `.strict()` is what keeps it that way as the install side grows.
 */
export const licenseSyncBodySchema = z
  .object({
    version: z.string().min(1).max(100),
    seats: z
      .object({
        members: z.number().int().min(0),
        liteMembers: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type LicenseSyncBody = z.infer<typeof licenseSyncBodySchema>;

/** The two refusals a sync adds to the credential's own. */
export const LICENSE_SYNC_REFUSALS = {
  ...CONNECT_CREDENTIAL_REFUSALS,
  validation_error: {
    status: 400,
    message: "a sync carries a version and two whole, non-negative seat counts",
  },
  rate_limited: {
    status: 429,
    message: "this license has synced too many times today",
  },
} as const;

export type LicenseSyncRefusalCode = keyof typeof LICENSE_SYNC_REFUSALS;

export type LicenseSyncResult =
  | {
      ok: true;
      lease: SignedLease;
      /** A reissued license waiting for this install, sent until it presents it. */
      license?: string;
    }
  | { ok: false; code: LicenseSyncRefusalCode };

/** Whether this license may sync again now. */
export interface LicenseSyncRateLimitPort {
  allow(params: { licenseRowId: string }): Promise<boolean>;
}

/** The credential service, as the sync uses it. It binds the instance on first use. */
export interface ConnectCredentialResolverPort {
  resolve(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialResolution>;
}

export interface LicenseSyncDependencies {
  credentials: ConnectCredentialResolverPort;
  repository: IssuedLicenseRepository;
  seatReports: LicenseSeatReportRepository;
  managedKeys: ConnectManagedKeyPort;
  rateLimit: LicenseSyncRateLimitPort;
  /** The signing key from the server secret, or undefined when none is set. */
  signingKey: () => string | undefined;
  /** Decrypts a license held for delivery. */
  decrypt: (cipher: string) => string;
  /** Attributed as the actor when a replaced license's managed key is ended. */
  systemActorId: string;
  now?: () => Date;
}

export class LicenseSyncService {
  private readonly now: () => Date;

  constructor(private readonly deps: LicenseSyncDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async recordSync(input: {
    token: string;
    instanceId: string | null | undefined;
    body: unknown;
  }): Promise<LicenseSyncResult> {
    const parsed = licenseSyncBodySchema.safeParse(input.body);
    if (!parsed.success) return { ok: false, code: "validation_error" };

    const resolution = await this.deps.credentials.resolve({
      token: input.token,
      instanceId: input.instanceId,
    });
    if (!resolution.ok) return { ok: false, code: resolution.code };

    const row = resolution.license;
    if (!(await this.deps.rateLimit.allow({ licenseRowId: row.id }))) {
      return { ok: false, code: "rate_limited" };
    }
    const privateKey = this.deps.signingKey();
    if (!privateKey || privateKey.trim() === "") {
      throw new LicenseSigningNotConfiguredError();
    }

    await this.record({
      row,
      seats: parsed.data.seats,
      version: parsed.data.version,
    });
    await this.completeDelivery(row);
    const license = await this.pendingDelivery(row);

    return {
      ok: true,
      lease: issueLease({
        licenseId: row.licenseId,
        instanceId: row.instanceId,
        services: entitledServices(row.services),
        seatOverageAllowance:
          row.seatOverageAllowance ??
          defaultSeatOverageAllowance(row.maxMembers),
        privateKey,
        now: this.now(),
      }),
      ...(license ? { license } : {}),
    };
  }

  /** The last report on the row, and the peak of the term quarter it falls in. */
  private async record({
    row,
    seats,
    version,
  }: {
    row: IssuedLicenseRecord;
    seats: LicenseSyncBody["seats"];
    version: string;
  }): Promise<void> {
    const now = this.now();
    await this.deps.repository.update(row.id, {
      lastSyncAt: now,
      lastSyncVersion: version,
      reportedMembers: seats.members,
      reportedMembersLite: seats.liteMembers,
    });
    await this.deps.seatReports.recordPeak({
      licenseId: row.id,
      quarterStartsAt: licenseTermQuarterStart({ issuedAt: row.issuedAt, now }),
      members: seats.members,
      membersLite: seats.liteMembers,
      at: now,
    });
  }

  /**
   * A sync that presents a license which was held for delivery proves the
   * install has it: the held copy is erased and the license it replaced is
   * retired, key first, the way revoking does.
   */
  private async completeDelivery(row: IssuedLicenseRecord): Promise<void> {
    if (!row.replacesId || !row.pendingDeliveryLicense) return;
    const replaced = await this.deps.repository.findById(row.replacesId);
    if (replaced?.virtualKeyId && replaced.organizationId) {
      await this.deps.managedKeys.retire({
        virtualKeyId: replaced.virtualKeyId,
        organizationId: replaced.organizationId,
        actorId: this.deps.systemActorId,
      });
    }
    if (replaced && !replaced.supersededAt) {
      await this.deps.repository.update(replaced.id, {
        supersededAt: this.now(),
      });
    }
    await this.deps.repository.update(row.id, { pendingDeliveryLicense: null });
  }

  /** The reissued license waiting for this install, decrypted, or nothing. */
  private async pendingDelivery(
    row: IssuedLicenseRecord,
  ): Promise<string | undefined> {
    const replacement = await this.deps.repository.findByReplacesId(row.id);
    if (!replacement?.pendingDeliveryLicense) return undefined;
    return this.deps.decrypt(replacement.pendingDeliveryLicense);
  }
}

/** The services the lease may name, which are the ones the lease schema knows. */
function entitledServices(services: string[]): ConnectService[] {
  return services.filter((service): service is ConnectService =>
    (CONNECT_SERVICES as readonly string[]).includes(service),
  );
}
