import type {
  AuthApi,
  PasskeyAssertionOptions,
  PasskeyAssertionResponse,
} from "@langwatch/auth-contract";
import { PasskeyAssertionRefusedError } from "@langwatch/auth-contract";
import { generate } from "@langwatch/ksuid";
import type { OpsApi } from "@langwatch/ops-contract";
import {
  STAFF_ACCESS_REQUESTER_KEY_PREFIX,
  StaffAccessCredentialRefusedError,
  StaffAccessNotFoundError,
  StaffAccessPasskeyRequiredError,
  type StaffAccessEnrolled,
  type StaffAccessRequesterView,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import type {
  StaffAccessChallengeRepository,
  StaffAccessRequesterRepository,
  StaffAccessRequesterRow,
} from "../repositories/staff-access.repository.ts";
import {
  assertionChallengeOf,
  freshChallenge,
  hasPassed,
  isoText,
  later,
  mintToken,
  parseToken,
  secretMatches,
  STAFF_ACCESS_CHALLENGE_TTL_MS,
  STAFF_ACCESS_ENROL_PURPOSE,
  STAFF_ACCESS_REQUESTER_TTL_MS,
} from "../rules/staff-access.rules.ts";
import type { StaffAccessNoticeService } from "./staff-access-notice.service.ts";

type RequesterDeps = Readonly<{
  requesters: StaffAccessRequesterRepository;
  challenges: StaffAccessChallengeRepository;
  auth: Pick<AuthApi, "hasPasskey" | "passkeyAssertionOptions" | "verifyPasskeyAssertion">;
  ops: Pick<OpsApi, "listPlatformOperators">;
  notices: StaffAccessNoticeService;
  now: () => Instant;
}>;

/**
 * An operator's enrolled agents: a passkey ceremony mints a 90-day `lwsr_` requester key, stored
 * only as a hash, which can create, poll, redeem and end its own access requests and nothing
 * else (ADR-202).
 */
export class StaffAccessRequesterService {
  private constructor(private readonly deps: RequesterDeps) {}

  static create(deps: RequesterDeps): StaffAccessRequesterService {
    return new StaffAccessRequesterService(deps);
  }

  /** @throws {StaffAccessPasskeyRequiredError} when the operator holds no passkey */
  async enrolOptions({ userId }: { userId: string }): Promise<PasskeyAssertionOptions> {
    if (!(await this.deps.auth.hasPasskey({ userId }))) throw new StaffAccessPasskeyRequiredError();
    const at = this.deps.now();
    const challenge = freshChallenge();
    await this.deps.challenges.create({
      id: generate("staffchallenge").toString(),
      userId,
      purpose: STAFF_ACCESS_ENROL_PURPOSE,
      challenge,
      expiresAt: later({ at, ms: STAFF_ACCESS_CHALLENGE_TTL_MS }),
      usedAt: null,
      createdAt: at,
    });
    return this.deps.auth.passkeyAssertionOptions({ userId, challenge });
  }

  /**
   * Verifies the assertion over one of the operator's open enrolment challenges, spends it, and
   * mints the requester key, shown this once.
   * @throws {StaffAccessPasskeyRequiredError} without a passkey
   * @throws {PasskeyAssertionRefusedError} when no open challenge matches or the signature fails
   */
  async enrol({
    userId,
    name,
    assertion,
  }: {
    userId: string;
    name: string;
    assertion: PasskeyAssertionResponse;
  }): Promise<StaffAccessEnrolled> {
    if (!(await this.deps.auth.hasPasskey({ userId }))) throw new StaffAccessPasskeyRequiredError();
    const at = this.deps.now();
    const signed = assertionChallengeOf({ clientDataJSON: assertion.response.clientDataJSON });
    const open = await this.deps.challenges.findOpen({
      userId,
      purpose: STAFF_ACCESS_ENROL_PURPOSE,
      at,
    });
    const challenge = open.find((row) => row.challenge === signed);
    if (!challenge) throw new PasskeyAssertionRefusedError({ reason: "bad_signature" });
    await this.deps.auth.verifyPasskeyAssertion({
      userId,
      challenge: challenge.challenge,
      response: assertion,
    });
    if (!(await this.deps.challenges.claim({ id: challenge.id, at }))) {
      throw new PasskeyAssertionRefusedError({ reason: "bad_signature" });
    }

    const minted = mintToken(STAFF_ACCESS_REQUESTER_KEY_PREFIX);
    const row: StaffAccessRequesterRow = {
      id: generate("staffrequester").toString(),
      ownerUserId: userId,
      name,
      lookupId: minted.lookupId,
      hashedSecret: minted.hashedSecret,
      expiresAt: later({ at, ms: STAFF_ACCESS_REQUESTER_TTL_MS }),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: at,
    };
    await this.deps.requesters.create(row);
    await this.deps.notices.tellOtherOperators({
      actingUserId: userId,
      subject: "An operator enrolled an agent for staff access",
      lines: [
        { label: "Agent", value: name },
        { label: "Expires", value: isoText(row.expiresAt) },
      ],
      idempotencyKey: `staff-access-enrolled:${row.id}`,
    });
    return { requesterKey: minted.token, requester: requesterViewOf(row) };
  }

  async findForOwner({ userId }: { userId: string }): Promise<StaffAccessRequesterView[]> {
    const rows = await this.deps.requesters.findByOwner({ ownerUserId: userId });
    return rows.map(requesterViewOf);
  }

  /** The requesters behind a set of ids, for naming sessions. */
  async findByIds({ ids }: { ids: readonly string[] }): Promise<StaffAccessRequesterRow[]> {
    const found = await Promise.all(
      [...new Set(ids)].map((id) => this.deps.requesters.findById({ id })),
    );
    return found.flat();
  }

  /**
   * Marks one of the operator's agents revoked, so its key is refused from now on. Ending its
   * sessions is the session service's part of the same revoke.
   * @throws {StaffAccessNotFoundError} for another operator's requester or one already revoked
   */
  async revoke({
    userId,
    requesterId,
  }: {
    userId: string;
    requesterId: string;
  }): Promise<StaffAccessRequesterRow> {
    const revoked = await this.deps.requesters.revoke({
      id: requesterId,
      ownerUserId: userId,
      at: this.deps.now(),
    });
    const [row] = await this.deps.requesters.findById({ id: requesterId });
    if (!revoked || !row) throw new StaffAccessNotFoundError();
    return row;
  }

  /**
   * The live requester an `lwsr_` key stands for, whose owner still holds the operator grant.
   * @throws {StaffAccessCredentialRefusedError} for any other key
   */
  async verify({ token }: { token: string | null }): Promise<StaffAccessRequesterRow> {
    const parsed = parseToken({ token, prefix: STAFF_ACCESS_REQUESTER_KEY_PREFIX });
    if (!parsed) throw new StaffAccessCredentialRefusedError();
    const at = this.deps.now();
    const [row] = await this.deps.requesters.findByLookupId({ lookupId: parsed.lookupId });
    const live =
      row !== undefined &&
      secretMatches({ secret: parsed.secret, hashed: row.hashedSecret }) &&
      row.revokedAt === null &&
      !hasPassed({ moment: row.expiresAt, at });
    if (!live) throw new StaffAccessCredentialRefusedError();
    const operators = await this.deps.ops.listPlatformOperators();
    if (!operators.some((operator) => operator.userId === row.ownerUserId)) {
      throw new StaffAccessCredentialRefusedError();
    }
    await this.deps.requesters.touch({ id: row.id, at });
    return row;
  }
}

function requesterViewOf(row: StaffAccessRequesterRow): StaffAccessRequesterView {
  return {
    id: row.id,
    name: row.name,
    createdAt: isoText(row.createdAt),
    expiresAt: isoText(row.expiresAt),
    lastUsedAt: row.lastUsedAt ? isoText(row.lastUsedAt) : null,
    revokedAt: row.revokedAt ? isoText(row.revokedAt) : null,
  };
}
