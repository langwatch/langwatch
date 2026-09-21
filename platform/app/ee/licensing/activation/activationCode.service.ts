/**
 * Issuing and redeeming activation codes (ADR-139, section 5).
 *
 * Redemption is the part that has to be exactly right. It is a public,
 * unauthenticated route, and a single-use code has to be redeemable exactly
 * once even when two installs post it in the same millisecond. So the decision
 * is not made here: the code reads the row, then asks the database to claim it
 * with the state it read as part of the write. Exactly one such statement finds
 * a row to update. Everybody else is told the code is already redeemed.
 *
 * This is the same shape as the fix CodeRabbit asked for on `attachVirtualKey`,
 * and for the same reason: a check followed by a write lets whatever landed in
 * between hand out something it should not have.
 *
 * The claim comes before the license is signed, so a code can only ever mint
 * one license. Signing then failing would otherwise burn the code, so a claim
 * whose minting failed is released again, conditionally on still being this
 * install's claim.
 *
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */

import { CONNECT_SERVICES, type ConnectService } from "../connect/services";
import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
} from "./activationCode";
import {
  type ActivationCodeRecord,
  type ActivationCodeRepository,
  type ActivationCodeView,
  statusOfActivationCode,
} from "./activationCodes";

/** Every way a redemption is refused, in the connect host's envelope. */
export const ACTIVATION_REFUSALS = {
  activation_code_malformed: {
    status: 400,
    message: "an activation code is LW followed by sixteen characters",
  },
  connect_instance_required: {
    status: 400,
    message: "an activation code must be presented with an instance id",
  },
  activation_code_not_found: {
    status: 401,
    message: "this activation code is not one we issued",
  },
  activation_code_expired: {
    status: 403,
    message: "this activation code has expired",
  },
  activation_code_already_redeemed: {
    status: 403,
    message: "this activation code has already been used",
  },
  rate_limited: {
    status: 429,
    message: "too many activation attempts; try again shortly",
  },
} as const;

export type ActivationRefusalCode = keyof typeof ACTIVATION_REFUSALS;

export type RedeemResult =
  | {
      ok: true;
      /** The signed license, handed over once. */
      licenseKey: string;
      planType: string;
      maxMembers: number;
      expiresAt: Date;
      services: string[];
    }
  | { ok: false; code: ActivationRefusalCode };

/** What an install may send as its instance id, matching the sync's rule. */
const INSTANCE_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The registry, as redemption uses it: it mints a license and nothing else. */
export interface LicenseMinterPort {
  issue(input: {
    customer: { organizationId: string };
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite?: number;
    expiresAt: Date;
    terms?: { services?: ConnectService[] };
    operatorId: string;
  }): Promise<{ licenseKey: string; license: { id: string } }>;
}

/** The services a license may name, which are the ones the lease knows. */
function entitledServices(services: string[]): ConnectService[] {
  return services.filter((service): service is ConnectService =>
    (CONNECT_SERVICES as readonly string[]).includes(service),
  );
}

/** Whether this code may be attempted again now. */
export interface ActivationRateLimitPort {
  allow(params: { codeHash: string }): Promise<boolean>;
}

export interface ActivationCodeDependencies {
  repository: ActivationCodeRepository;
  licenses: LicenseMinterPort;
  rateLimit: ActivationRateLimitPort;
  /** Attributed as the operator on a license a code minted. */
  systemActorId: string;
  now?: () => Date;
}

export class ActivationCodeService {
  private readonly now: () => Date;

  constructor(private readonly deps: ActivationCodeDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * A fresh code. Returned once, in plain text, and never readable again: the
   * row holds only its hash and its last four characters.
   */
  async issue(input: {
    organizationId: string;
    organizationName: string;
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite?: number;
    licenseTermDays: number;
    services?: string[];
    expiresAt: Date;
    reusable?: boolean;
    operatorId: string;
  }): Promise<{ code: string; row: ActivationCodeView }> {
    const code = mintActivationCode();
    const normalised = normaliseActivationCode(code);
    if (!normalised) {
      throw new Error("a minted activation code failed its own shape check");
    }

    const row = await this.deps.repository.create({
      codeHash: activationCodeHash(normalised),
      codeHint: activationCodeHint(normalised),
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      email: input.email,
      planType: input.planType,
      maxMembers: input.maxMembers,
      maxMembersLite: input.maxMembersLite ?? 0,
      licenseTermDays: input.licenseTermDays,
      services: input.services ?? [],
      expiresAt: input.expiresAt,
      reusable: input.reusable ?? false,
      createdById: input.operatorId,
    });

    return { code, row: this.view(row) };
  }

  async getAll(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<{ codes: ActivationCodeView[]; total: number }> {
    const { rows, total } = await this.deps.repository.findAll(input);
    return { codes: rows.map((row) => this.view(row)), total };
  }

  async revoke(input: {
    id: string;
    operatorId: string;
  }): Promise<ActivationCodeView | null> {
    const row = await this.deps.repository.revoke({
      id: input.id,
      at: this.now(),
      revokedById: input.operatorId,
    });
    return row ? this.view(row) : null;
  }

  /** One install presenting one code. */
  async redeem(input: {
    code: string;
    instanceId: string | null | undefined;
  }): Promise<RedeemResult> {
    const normalised = normaliseActivationCode(input.code ?? "");
    if (!normalised) return refuse("activation_code_malformed");

    const instanceId = input.instanceId?.trim() ?? "";
    if (!INSTANCE_ID_SHAPE.test(instanceId)) {
      return refuse("connect_instance_required");
    }

    const codeHash = activationCodeHash(normalised);
    if (!(await this.deps.rateLimit.allow({ codeHash }))) {
      return refuse("rate_limited");
    }

    const row = await this.deps.repository.findByCodeHash(codeHash);
    // A revoked code reads exactly like one that never existed. The caller may
    // be holding a code it should not have, and which of the two it is tells
    // them something about our customers.
    if (!row || row.revokedAt) return refuse("activation_code_not_found");

    const now = this.now();
    if (row.expiresAt.getTime() <= now.getTime()) {
      return refuse("activation_code_expired");
    }

    const claim = row.reusable
      ? await this.deps.repository.recordReusableRedemption({
          id: row.id,
          instanceId,
          at: now,
        })
      : await this.deps.repository.claimSingleUse({
          id: row.id,
          instanceId,
          at: now,
        });

    if (!claim) return this.whyTheClaimLost({ row, at: now });

    try {
      return await this.mint({ row, now });
    } catch (error) {
      // Signing failed after the code was claimed. Leaving the claim would burn
      // a code that minted nothing, so it goes back, conditionally on still
      // being this install's claim: another install may have redeemed a
      // reusable code in between, and that redemption is not ours to undo.
      await this.deps.repository.releaseClaim({ id: row.id, instanceId });
      throw error;
    }
  }

  /**
   * Why a claim found no row to update.
   *
   * A claim can only lose to a row that changed between the read and the write,
   * so the row is read back to say which change it was rather than guessing.
   */
  private async whyTheClaimLost({
    row,
    at,
  }: {
    row: ActivationCodeRecord;
    at: Date;
  }): Promise<RedeemResult> {
    const current = await this.deps.repository.findById(row.id);
    if (!current || current.revokedAt) {
      return refuse("activation_code_not_found");
    }
    if (current.expiresAt.getTime() <= at.getTime()) {
      return refuse("activation_code_expired");
    }
    return refuse("activation_code_already_redeemed");
  }

  /** The license this code describes, signed and handed over once. */
  private async mint({
    row,
    now,
  }: {
    row: ActivationCodeRecord;
    now: Date;
  }): Promise<RedeemResult> {
    const expiresAt = new Date(now.getTime() + row.licenseTermDays * DAY_MS);
    const issued = await this.deps.licenses.issue({
      customer: { organizationId: row.organizationId },
      email: row.email,
      planType: row.planType,
      maxMembers: row.maxMembers,
      maxMembersLite: row.maxMembersLite,
      expiresAt,
      terms: { services: entitledServices(row.services) },
      operatorId: this.deps.systemActorId,
    });

    if (!row.reusable) {
      await this.deps.repository.attachIssuedLicense({
        id: row.id,
        issuedLicenseId: issued.license.id,
      });
    }

    return {
      ok: true,
      licenseKey: issued.licenseKey,
      planType: row.planType,
      maxMembers: row.maxMembers,
      expiresAt,
      services: row.services,
    };
  }

  private view(row: ActivationCodeRecord): ActivationCodeView {
    return { ...row, status: statusOfActivationCode(row, this.now()) };
  }
}

function refuse(code: ActivationRefusalCode): RedeemResult & { ok: false } {
  return { ok: false, code };
}
