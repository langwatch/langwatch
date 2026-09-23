/**
 * Issuing and redeeming activation codes (ADR-156 §5). The database settles a
 * concurrent redemption, never a check here.
 * @see specs/self-hosting/connected-services/activation-codes.feature
 */

import {
  ActivationCodeAlreadyRedeemedError,
  ActivationCodeExpiredError,
  ActivationCodeMalformedError,
  ActivationCodeNotFoundError,
  ActivationRateLimitedError,
  ConnectInstanceRequiredError,
  entitledConnectServices,
  type ActivationAnswer,
  type ActivationCodePage,
  type ActivationCodeView,
  type ActivationRedemption,
  type ConnectPresentedCredential,
  type ConnectService,
  type IssueActivationCodeInput,
  type IssuedActivationCode,
} from "@langwatch/enterprise-licensing-contract";
import { licenseSeats } from "@langwatch/plans";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type {
  ActivationCodeRecord,
  ActivationCodeRepository,
} from "../repositories/activation-code.repository.ts";
import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
  statusOfActivationCode,
} from "../rules/activation-code.rules.ts";
import { bearerTokenOf } from "../rules/connect-presented-credential.rules.ts";
import { isInstanceIdShape } from "../rules/license-token.rules.ts";

const HOURS_PER_DAY = 24;

/** The registry, as redemption uses it: it mints a license and nothing else. */
export interface LicenseMinter {
  issue(input: {
    customer: { organizationId: string };
    email: string;
    planType: string;
    maxMembers: number;
    maxMembersLite: number | undefined;
    expiresAt: Instant;
    terms?: { services?: ConnectService[] };
    operatorId: string;
  }): Promise<{ licenseKey: string; license: { id: string } }>;
}

/** Whether this code may be attempted again now. */
export interface ActivationRateLimit {
  allow(params: { codeHash: string }): Promise<boolean>;
}

/** Binds a freshly minted license to its install and writes its key's facts. */
export interface ActivationCredentials {
  resolve(input: { token: string; instanceId: string }): Promise<{ ok: boolean }>;
  tokenOf(licenseKey: string): string;
}

export interface ActivationCodeCollaborators {
  repository: ActivationCodeRepository;
  licenses: LicenseMinter;
  /** So the first hosted call after activation is not refused for want of a sync. */
  credentials: ActivationCredentials;
  rateLimit: ActivationRateLimit;
  /** Attributed as the operator on a license a code minted. */
  systemActorId: string;
  now?: () => Instant;
}

export class ActivationCodeService {
  static create(collaborators: ActivationCodeCollaborators): ActivationCodeService {
    return new ActivationCodeService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: ActivationCodeCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

  /** Returned once, in plain text: the row holds only its hash and hint. */
  async issue(input: IssueActivationCodeInput): Promise<IssuedActivationCode> {
    const code = mintActivationCode();
    const normalised = normaliseActivationCode(code);
    if (!normalised) throw new Error("a minted activation code failed its own shape check");

    const row = await this.collaborators.repository.create({
      codeHash: activationCodeHash(normalised),
      codeHint: activationCodeHint(normalised),
      organizationId: input.organizationId,
      organizationName: input.organizationName,
      email: input.email,
      planType: input.planType,
      ...licenseSeats({ members: input.maxMembers, membersLite: input.maxMembersLite }),
      licenseTermDays: input.licenseTermDays,
      services: input.services ?? [],
      expiresAt: Temporal.Instant.from(input.expiresAt),
      reusable: input.reusable ?? false,
      createdById: input.operatorId,
    });

    return { code, row: this.#view(row) };
  }

  async list(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<ActivationCodePage> {
    const { rows, total } = await this.collaborators.repository.findAll(input);
    return { codes: rows.map((row) => this.#view(row)), total };
  }

  /** Revoking twice, or revoking a code that never was, refuses by name. */
  async revoke(input: { id: string; operatorId: string }): Promise<ActivationCodeView> {
    const revoked = await this.collaborators.repository.revoke({
      id: input.id,
      at: this.#now(),
      revokedById: input.operatorId,
    });
    const row = revoked ? await this.collaborators.repository.findById(input.id) : null;
    if (!row) throw new ActivationCodeNotFoundError();
    return this.#view(row);
  }

  /** The connect host's answer: the code travels as the bearer, as a license token does. */
  async answer(input: ConnectPresentedCredential): Promise<ActivationAnswer> {
    const redemption = await this.redeem({
      code: bearerTokenOf(input.authorization),
      instanceId: input.instanceId,
    });
    return {
      license: redemption.licenseKey,
      planType: redemption.planType,
      maxMembers: redemption.maxMembers,
      expiresAt: redemption.expiresAt,
      services: redemption.services,
    };
  }

  /** One install presenting one code. */
  async redeem(input: {
    code: string;
    instanceId: string | null | undefined;
  }): Promise<ActivationRedemption> {
    const normalised = normaliseActivationCode(input.code ?? "");
    if (!normalised) throw new ActivationCodeMalformedError();

    const instanceId = input.instanceId?.trim() ?? "";
    if (!isInstanceIdShape(instanceId)) throw new ConnectInstanceRequiredError();

    const codeHash = activationCodeHash(normalised);
    if (!(await this.collaborators.rateLimit.allow({ codeHash }))) {
      throw new ActivationRateLimitedError();
    }

    const row = await this.collaborators.repository.findByCodeHash(codeHash);
    // A revoked code reads exactly like one that never existed: which of the
    // two it is would tell the caller something about our customers.
    if (!row || row.revokedAt) throw new ActivationCodeNotFoundError();

    const now = this.#now();
    if (Temporal.Instant.compare(now, row.expiresAt) >= 0) throw new ActivationCodeExpiredError();

    const claimed = await this.#claim({ row, instanceId, at: now });
    if (!claimed) throw await this.#whyTheClaimLost({ row, at: now });

    try {
      return await this.#mint({ row, instanceId, now });
    } catch (error) {
      // Signing failed after the code was claimed. Leaving the claim would burn
      // a code that minted nothing, so it goes back, conditionally on still
      // being this install's claim.
      await this.collaborators.repository.releaseClaim({ id: row.id, instanceId });
      throw error;
    }
  }

  /** The one write that decides: the state read is part of it, so a
   *  single-use code answers true to exactly one concurrent post. */
  async #claim({
    row,
    instanceId,
    at,
  }: {
    row: ActivationCodeRecord;
    instanceId: string;
    at: Instant;
  }): Promise<boolean> {
    const claim = { id: row.id, instanceId, at };
    return row.reusable
      ? this.collaborators.repository.recordReusableRedemption(claim)
      : this.collaborators.repository.claimSingleUse(claim);
  }

  /** Why a claim found no row: read back rather than guessed, since it can
   *  only lose to a change between the read and the write. */
  async #whyTheClaimLost({ row, at }: { row: ActivationCodeRecord; at: Instant }): Promise<Error> {
    const current = await this.collaborators.repository.findById(row.id);
    if (!current || current.revokedAt) return new ActivationCodeNotFoundError();
    if (Temporal.Instant.compare(at, current.expiresAt) >= 0) {
      return new ActivationCodeExpiredError();
    }
    return new ActivationCodeAlreadyRedeemedError();
  }

  /** The license this code describes, signed and handed over once. */
  async #mint({
    row,
    instanceId,
    now,
  }: {
    row: ActivationCodeRecord;
    instanceId: string;
    now: Instant;
  }): Promise<ActivationRedemption> {
    const expiresAt = now.add({ hours: row.licenseTermDays * HOURS_PER_DAY });
    const issued = await this.collaborators.licenses.issue({
      customer: { organizationId: row.organizationId },
      email: row.email,
      planType: row.planType,
      ...licenseSeats({ members: row.maxMembers, membersLite: row.maxMembersLite }),
      expiresAt,
      terms: { services: entitledConnectServices(row.services) },
      operatorId: this.collaborators.systemActorId,
    });

    if (!row.reusable) {
      await this.collaborators.repository.attachIssuedLicense({
        id: row.id,
        issuedLicenseId: issued.license.id,
      });
    }
    // A refusal here leaves nothing to undo: the install's first sync resolves it again.
    await this.collaborators.credentials.resolve({
      token: this.collaborators.credentials.tokenOf(issued.licenseKey),
      instanceId,
    });

    return {
      licenseKey: issued.licenseKey,
      planType: row.planType,
      maxMembers: row.maxMembers,
      expiresAt: expiresAt.toString(),
      services: row.services,
    };
  }

  #view(row: ActivationCodeRecord): ActivationCodeView {
    return {
      ...row,
      expiresAt: row.expiresAt.toString(),
      redeemedAt: row.redeemedAt?.toString() ?? null,
      revokedAt: row.revokedAt?.toString() ?? null,
      createdAt: row.createdAt.toString(),
      status: statusOfActivationCode(row, this.#now()),
    };
  }
}
