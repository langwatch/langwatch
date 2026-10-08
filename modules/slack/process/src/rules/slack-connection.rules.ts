import type {
  SlackConnectionKind,
  SlackConnectionScopeType,
  SlackConnectionSecret,
  SlackConnectionView,
} from "@langwatch/slack-contract";
import { InvalidSlackConnectionInputError } from "@langwatch/slack-contract";
import { toDate } from "@langwatch/time";

import type {
  SlackConnectionRow,
  SlackScope,
} from "../repositories/slack-connection.repository.ts";
import { slackSecretFingerprint } from "./slack-secret-fingerprint.rules.ts";

/** Where a project sits: what an ORGANIZATION connection is checked against. */
export interface SlackProjectScope {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
}

/**
 * One secret's fingerprints: `current` is the only one ever written, `retired`
 * are the ones a row stored before a key rotation may still carry.
 */
export interface SecretIdentity {
  current: string;
  retired: string[];
}

/** A connection may only be scoped to the calling project or its organization. */
export function assertReachableScope({
  scope,
  target,
}: {
  scope: SlackProjectScope;
  target: SlackScope;
}): void {
  const expected = target.scopeType === "ORGANIZATION" ? scope.organizationId : scope.projectId;
  if (target.scopeId !== expected) {
    throw new InvalidSlackConnectionInputError(
      "A Slack connection is scoped to this project or to its organization.",
      "scopeId",
    );
  }
}

/** Where an edit moves a connection; a bare scope type means this project or org. */
export function targetScope({
  connection,
  scope,
  scopeType,
  scopeId,
}: {
  connection: SlackScope;
  scope: SlackProjectScope;
  scopeType?: SlackConnectionScopeType;
  scopeId?: string;
}): SlackScope {
  const type = scopeType ?? connection.scopeType;
  if (scopeId !== undefined) return { scopeType: type, scopeId };
  if (type === connection.scopeType) return { scopeType: type, scopeId: connection.scopeId };
  return {
    scopeType: type,
    scopeId: type === "ORGANIZATION" ? scope.organizationId : scope.projectId,
  };
}

/** The scopes a project reaches: its organization's and its own (ADR-093 §5a). */
export function reachableScopes({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}): SlackScope[] {
  return [
    { scopeType: "ORGANIZATION", scopeId: organizationId },
    { scopeType: "PROJECT", scopeId: projectId },
  ];
}

/** Whether the project may deliver through the connection (ADR-093 §5a). */
export function isUsableBy({
  connection,
  scope,
}: {
  connection: SlackConnectionRow;
  scope: SlackProjectScope;
}): boolean {
  if (connection.organizationId !== scope.organizationId) return false;
  return connection.scopeType === "ORGANIZATION"
    ? connection.scopeId === scope.organizationId
    : connection.scopeId === scope.projectId;
}

export function scopeNameOf({
  row,
  scope,
}: {
  row: SlackConnectionRow;
  scope: SlackProjectScope;
}): string {
  if (row.scopeType === "ORGANIZATION") return scope.organizationName;
  return row.scopeId === scope.projectId ? scope.projectName : row.scopeId;
}

export function toView({
  row,
  scope,
  dependentAutomations,
}: {
  row: SlackConnectionRow;
  scope: SlackProjectScope;
  dependentAutomations: number;
}): SlackConnectionView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeName: scopeNameOf({ row, scope }),
    secretHint: row.secretHint,
    slackTeamId: row.slackTeamId,
    slackTeamName: row.slackTeamName,
    dependentAutomations,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

/** A secret's fingerprint under the current key, and under the previous key when one is set. */
export function secretIdentity({
  secret,
  key,
  previousKey,
}: {
  secret: string;
  key: string;
  previousKey: string | undefined;
}): SecretIdentity {
  const current = slackSecretFingerprint({ secret, key });
  if (!previousKey || previousKey === key) return { current, retired: [] };
  return { current, retired: [slackSecretFingerprint({ secret, key: previousKey })] };
}

/**
 * The identity of the secret an edited connection ends up holding. One keeping
 * its secret is also looked up by its stored fingerprint, which a rotation may
 * have left behind the current key.
 */
export function heldSecretIdentity({
  connection,
  replacement,
  key,
  previousKey,
}: {
  connection: SlackConnectionRow;
  replacement: string | undefined;
  key: string;
  previousKey: string | undefined;
}): SecretIdentity {
  if (replacement) return secretIdentity({ secret: replacement, key, previousKey });
  const secret = connection.botToken ?? connection.webhookUrl;
  if (!secret) return { current: connection.secretFingerprint, retired: [] };
  const { current, retired } = secretIdentity({ secret, key, previousKey });
  return {
    current,
    retired: [...new Set([...retired, connection.secretFingerprint])].filter(
      (fingerprint) => fingerprint !== current,
    ),
  };
}

export function secretFields({ kind, secret }: { kind: SlackConnectionKind; secret: string }): {
  botToken: string | null;
  webhookUrl: string | null;
} {
  return kind === "BOT"
    ? { botToken: secret, webhookUrl: null }
    : { botToken: null, webhookUrl: secret };
}

export function connectionSecret({
  connection,
}: {
  connection: SlackConnectionRow;
}): SlackConnectionSecret[] {
  if (connection.kind === "BOT") {
    return connection.botToken ? [{ kind: "BOT", token: connection.botToken }] : [];
  }
  return connection.webhookUrl ? [{ kind: "INCOMING_WEBHOOK", url: connection.webhookUrl }] : [];
}
