import type { AgentSlug } from "@langwatch/contracts/agent-onboarding";
import type {
  Clock,
  CreateEphemeralAccountParams,
  EphemeralAccountRepository,
  HandoffStore,
  PasskeyCredential,
  PasskeyRepository,
  ProvisionedWorkspace,
  RateLimitDecision,
  RateLimiter,
  WebAuthnCeremony,
  WorkspaceProvisioner,
} from "../app/ports.js";
import type { EphemeralAccount } from "../domain/account.js";
import type { ClaimHandoff } from "../domain/handoff.js";

/** A clock the test moves by hand — lifecycle arithmetic is the thing under
 *  test, so it must never depend on how long the suite takes to run. */
export class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
  advanceDays(days: number): void {
    this.current = new Date(
      this.current.getTime() + days * 24 * 60 * 60 * 1000,
    );
  }
}

export class FakeAccountRepository implements EphemeralAccountRepository {
  readonly rows = new Map<string, EphemeralAccount>();
  private sequence = 0;

  async create(
    params: CreateEphemeralAccountParams,
  ): Promise<EphemeralAccount> {
    const id = `acct_${++this.sequence}`;
    const account: EphemeralAccount = {
      id,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      projectSlug: params.projectSlug,
      projectName: params.projectName,
      agent: params.agent,
      provisionedAt: params.provisionedAt,
      ingestionStopsAt: params.ingestionStopsAt,
      deleteAfter: params.deleteAfter,
      claimedAt: null,
      claimedByUserId: null,
    };
    this.rows.set(id, account);
    this.tokens.set(params.claimTokenHash, id);
    return account;
  }

  readonly tokens = new Map<string, string>();

  async findByClaimTokenHash(hash: string): Promise<EphemeralAccount | null> {
    const id = this.tokens.get(hash);
    return id === undefined ? null : (this.rows.get(id) ?? null);
  }

  async findById(id: string): Promise<EphemeralAccount | null> {
    return this.rows.get(id) ?? null;
  }

  async markClaimed(params: {
    id: string;
    userId: string;
    claimedAt: Date;
  }): Promise<EphemeralAccount | null> {
    const row = this.rows.get(params.id);
    // Mirrors the conditional UPDATE: a second claim finds it non-null and
    // loses, which is what the double-claim tests rely on.
    if (!row || row.claimedAt !== null) return null;
    const claimed: EphemeralAccount = {
      ...row,
      claimedAt: params.claimedAt,
      claimedByUserId: params.userId,
      ingestionStopsAt: null,
      deleteAfter: null,
    };
    this.rows.set(params.id, claimed);
    return claimed;
  }

  seed(account: EphemeralAccount, claimTokenHash: string): void {
    this.rows.set(account.id, account);
    this.tokens.set(claimTokenHash, account.id);
  }
}

export class FakeHandoffStore implements HandoffStore {
  readonly records = new Map<string, ClaimHandoff>();
  readonly polls = new Set<string>();
  /** Set true to simulate the CLI polling faster than the advertised gap. */
  refusePolls = false;

  async put(params: {
    codeHash: string;
    handoff: ClaimHandoff;
  }): Promise<void> {
    this.records.set(params.codeHash, params.handoff);
  }

  async get(codeHash: string): Promise<ClaimHandoff | null> {
    return this.records.get(codeHash) ?? null;
  }

  async approve(params: {
    codeHash: string;
    userId: string;
  }): Promise<ClaimHandoff | null> {
    const existing = this.records.get(params.codeHash);
    if (!existing || existing.status === "approved") return null;
    const approved: ClaimHandoff = {
      ...existing,
      status: "approved",
      approvedByUserId: params.userId,
    };
    this.records.set(params.codeHash, approved);
    return approved;
  }

  async consume(codeHash: string): Promise<void> {
    this.records.delete(codeHash);
  }

  async allowPoll(params: { codeHash: string }): Promise<boolean> {
    if (this.refusePolls) return false;
    this.polls.add(params.codeHash);
    return true;
  }

  async setPasskeyChallenge(params: {
    codeHash: string;
    challenge: string;
  }): Promise<ClaimHandoff | null> {
    const existing = this.records.get(params.codeHash);
    if (!existing) return null;
    const updated: ClaimHandoff = {
      ...existing,
      passkeyChallenge: params.challenge,
    };
    this.records.set(params.codeHash, updated);
    return updated;
  }
}

export class FakePasskeyRepository implements PasskeyRepository {
  readonly stored: Array<{
    userId: string;
    label: string | null;
    credential: PasskeyCredential;
  }> = [];

  async create(params: {
    userId: string;
    label: string | null;
    credential: PasskeyCredential;
  }): Promise<void> {
    this.stored.push(params);
  }

  async countForUser(userId: string): Promise<number> {
    return this.stored.filter((c) => c.userId === userId).length;
  }
}

/** Stands in for the browser + authenticator, so enrollment is unit-testable. */
export class FakeWebAuthnCeremony implements WebAuthnCeremony {
  readonly challenges: string[] = [];
  /** Set false to simulate an attestation that does not verify. */
  verifies = true;

  async buildRegistrationOptions(params: {
    userId: string;
  }): Promise<{ options: Record<string, unknown>; challenge: string }> {
    const challenge = `challenge-for-${params.userId}`;
    this.challenges.push(challenge);
    return { options: { challenge, rp: { name: "LangWatch" } }, challenge };
  }

  async verifyRegistration(params: {
    expectedChallenge: string;
  }): Promise<PasskeyCredential | null> {
    if (!this.verifies) return null;
    return {
      credentialId: `cred-for-${params.expectedChallenge}`,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: ["internal", "hybrid"],
    };
  }
}

/** Counts every bucket it is asked about, and refuses the ones told to. */
export class FakeRateLimiter implements RateLimiter {
  readonly consumed: string[] = [];
  readonly exhausted = new Set<string>();
  /** Set to make every call throw, standing in for an unreachable Redis. */
  unavailable = false;

  async consume(params: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<RateLimitDecision> {
    if (this.unavailable) throw new Error("redis unavailable");
    this.consumed.push(params.key);
    const axis = params.key.split(":")[0] ?? "";
    if (this.exhausted.has(axis)) {
      return { allowed: false, retryAfterSeconds: 42 };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Axis names, in the order they were metered. */
  axesTouched(): string[] {
    return this.consumed.map((key) => key.split(":")[0] ?? "");
  }
}

export class FakeWorkspaceProvisioner implements WorkspaceProvisioner {
  readonly promoted: Array<{
    placeholderUserId: string;
    email?: string | null;
    name?: string | null;
  }> = [];
  readonly transferred: Array<{
    organizationId: string;
    placeholderUserId: string;
    claimingUserId: string;
  }> = [];
  provisionCalls = 0;
  /** Set to make provisioning blow up, standing in for a failed key mint. */
  failure: Error | null = null;

  async provision(params: {
    projectName: string;
    agent: AgentSlug;
  }): Promise<ProvisionedWorkspace> {
    this.provisionCalls += 1;
    if (this.failure) throw this.failure;
    const n = this.provisionCalls;
    return {
      userId: `user_placeholder_${n}`,
      organizationId: `org_${n}`,
      teamId: `team_${n}`,
      projectId: `proj_${n}`,
      projectSlug: `slug-${n}`,
      projectName: params.projectName,
      ingestionKey: { token: `ik-lw-token-${n}`, prefix: "ik-lw-token" },
    };
  }

  async promotePlaceholder(params: {
    placeholderUserId: string;
    email?: string | null;
    name?: string | null;
  }): Promise<void> {
    this.promoted.push(params);
  }

  async transferToExistingUser(params: {
    organizationId: string;
    placeholderUserId: string;
    claimingUserId: string;
  }): Promise<void> {
    this.transferred.push(params);
  }
}

const DAY = 24 * 60 * 60 * 1000;

export function anAccount(
  overrides: Partial<EphemeralAccount> = {},
): EphemeralAccount {
  const provisionedAt =
    overrides.provisionedAt ?? new Date("2026-01-01T00:00:00Z");
  return {
    id: "acct_seed",
    userId: "user_placeholder_seed",
    organizationId: "org_seed",
    projectId: "proj_seed",
    projectSlug: "slug-seed",
    projectName: "Claude Code",
    agent: "claude_code",
    provisionedAt,
    ingestionStopsAt: new Date(provisionedAt.getTime() + 7 * DAY),
    deleteAfter: new Date(provisionedAt.getTime() + 30 * DAY),
    claimedAt: null,
    claimedByUserId: null,
    ...overrides,
  };
}
