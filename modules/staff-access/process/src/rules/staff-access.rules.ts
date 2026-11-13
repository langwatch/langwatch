/**
 * Staff access's pure decisions (ADR-202): lifetimes, the token shape, the canonical hash a
 * passkey approves, which approvals need the organization name typed, and the shown status.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { StaffAccessScope } from "@langwatch/authz-contract";
import {
  StaffAccessAlreadyRedeemedError,
  StaffAccessRequestExpiredError,
  StaffAccessRequestNotApprovedError,
  StaffAccessRequestNotPendingError,
  type StaffAccessRequestStatus,
} from "@langwatch/staff-access-contract";
import { type Instant, Temporal } from "@langwatch/time";

export const STAFF_ACCESS_REQUEST_TTL_MS = 10 * 60 * 1000;
export const STAFF_ACCESS_SESSION_TTL_MS = 60 * 60 * 1000;
export const STAFF_ACCESS_REQUESTER_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const STAFF_ACCESS_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const STAFF_ACCESS_REQUESTS_PER_HOUR = 5;
export const STAFF_ACCESS_RATE_WINDOW_MS = 60 * 60 * 1000;
/** How far back the console lists sessions. */
export const STAFF_ACCESS_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const STAFF_ACCESS_ENROL_PURPOSE = "enrol";

/** How the usage answer tells UI from API use, for the agent reading it. */
export const STAFF_ACCESS_USAGE_CLASSIFICATION =
  "Coding agent sessions, gateway requests and traces arrive over the API (SDKs, the CLI, coding " +
  "agent hooks and the gateway), so they measure API use. API key last-used times say which keys " +
  "still call. membersSignedIn counts members holding a live browser session, which is UI use. " +
  "An organization with API figures and no signed-in members uses LangWatch through the API only.";

/** Whether the scopes reach into one organization, which mints an organization key. */
export function reachesOrganization(scopes: readonly StaffAccessScope[]): boolean {
  return scopes.some((scope) => scope !== "ops:read");
}

/** Support writes as "LangWatch Support"; anything else reads as "LangWatch Staff Read". */
export function staffKeyKindOf(scopes: readonly StaffAccessScope[]): "support" | "read" {
  return scopes.includes("org:support") ? "support" : "read";
}

/** Content and support always need the name typed, with or without spend. */
export function typedNameRequired({
  scopes,
}: {
  scopes: readonly StaffAccessScope[];
  spendApproved: boolean;
}): boolean {
  return scopes.includes("org:content") || scopes.includes("org:support");
}

export function organizationNameMatches({
  typed,
  actual,
}: {
  typed: string | undefined;
  actual: string | null;
}): boolean {
  return actual !== null && typed !== undefined && typed.trim() === actual.trim();
}

/** Exactly what the approval page shows and the operator chose, signed by the passkey. */
export type StaffAccessApprovalFields = Readonly<{
  requestId: string;
  scopes: readonly string[];
  organizationId: string | null;
  organizationName: string | null;
  reason: string;
  machine: string;
  requestIp: string | null;
  codeChallenge: string;
  spendApproved: boolean;
  expiresAt: string;
}>;

/** base64url(SHA-256(canonical JSON)): keys sorted, scopes sorted, nothing else. */
export function approvalChallengeOf(fields: StaffAccessApprovalFields): string {
  const canonical = {
    codeChallenge: fields.codeChallenge,
    expiresAt: fields.expiresAt,
    machine: fields.machine,
    organizationId: fields.organizationId,
    organizationName: fields.organizationName,
    reason: fields.reason,
    requestId: fields.requestId,
    requestIp: fields.requestIp,
    scopes: fields.scopes.toSorted(),
    spendApproved: fields.spendApproved,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url");
}

/** The PKCE S256 transform of a verifier. */
export function pkceChallengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** A fresh `<prefix><lookupId>_<secret>` token with the hash stored for it. */
export function mintToken(prefix: string): {
  token: string;
  lookupId: string;
  hashedSecret: string;
} {
  const lookupId = randomBytes(12).toString("base64url").replace(/[-_]/g, "x");
  const secret = randomBytes(32).toString("base64url");
  return { token: `${prefix}${lookupId}_${secret}`, lookupId, hashedSecret: hashSecret(secret) };
}

/** The lookup id and secret of a token carrying `prefix`, or undefined for any other shape. */
export function parseToken({
  token,
  prefix,
}: {
  token: string | null;
  prefix: string;
}): { lookupId: string; secret: string } | undefined {
  if (!token?.startsWith(prefix)) return undefined;
  const body = token.slice(prefix.length);
  const separator = body.indexOf("_");
  if (separator <= 0 || separator === body.length - 1) return undefined;
  return { lookupId: body.slice(0, separator), secret: body.slice(separator + 1) };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches({ secret, hashed }: { secret: string; hashed: string }): boolean {
  const stored = Buffer.from(hashed, "hex");
  const candidate = Buffer.from(hashSecret(secret), "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

/** A fresh base64url challenge for a passkey ceremony. */
export function freshChallenge(): string {
  return randomBytes(32).toString("base64url");
}

/** The status a reader sees: an undecided request or a session past its time reads `expired`. */
export function shownStatus({
  status,
  expiresAt,
  accessExpiresAt,
  at,
}: {
  status: string;
  expiresAt: Instant;
  accessExpiresAt: Instant | null;
  at: Instant;
}): StaffAccessRequestStatus {
  const undecided = status === "pending" || status === "approved";
  if (undecided && hasPassed({ moment: expiresAt, at })) return "expired";
  const sessionOver = accessExpiresAt !== null && hasPassed({ moment: accessExpiresAt, at });
  if (status === "redeemed" && sessionOver) return "expired";
  return status as StaffAccessRequestStatus;
}

/** The challenge a WebAuthn assertion was made over, from its client data; "" when unreadable. */
export function assertionChallengeOf({ clientDataJSON }: { clientDataJSON: string }): string {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("challenge" in parsed)) return "";
    return typeof parsed.challenge === "string" ? parsed.challenge : "";
  } catch {
    return "";
  }
}

/** Millisecond ISO text, the shape every staff access answer carries. */
export function isoText(at: Instant): string {
  return at.toString({ smallestUnit: "millisecond" });
}

/** Whether `moment` is at or before `at`. */
export function hasPassed({ moment, at }: { moment: Instant; at: Instant }): boolean {
  return Temporal.Instant.compare(moment, at) <= 0;
}

/** `at` moved forward by `ms` milliseconds. */
export function later({ at, ms }: { at: Instant; ms: number }): Instant {
  return at.add({ milliseconds: ms });
}

/** The request fields the pending and redeemable checks read. */
type DecisionRow = Readonly<{
  status: string;
  expiresAt: Instant;
  redeemedAt: Instant | null;
}>;

/** @throws when the request is no longer pending or its ten minutes passed */
export function assertPending({ row, at }: { row: DecisionRow; at: Instant }): void {
  if (row.status !== "pending") throw new StaffAccessRequestNotPendingError();
  if (hasPassed({ moment: row.expiresAt, at })) throw new StaffAccessRequestExpiredError();
}

/** @throws when the request was redeemed, lapsed or is not approved */
export function assertRedeemable({ row, at }: { row: DecisionRow; at: Instant }): void {
  if (row.redeemedAt !== null || row.status === "redeemed") {
    throw new StaffAccessAlreadyRedeemedError();
  }
  const undecidedOrApproved = row.status === "pending" || row.status === "approved";
  if (undecidedOrApproved && hasPassed({ moment: row.expiresAt, at }))
    throw new StaffAccessRequestExpiredError();
  if (row.status !== "approved") throw new StaffAccessRequestNotApprovedError();
}
