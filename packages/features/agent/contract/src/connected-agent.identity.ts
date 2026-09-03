/**
 * The identity of a connected agent (ADR-128, "Identity").
 *
 * One row per project, name, environment and scope. The environment is what
 * the SDK resolved; the scope is derived from it and from the credential that
 * registered: a development agent belongs to the key's owner, or to the host
 * when the key names no person. Every other environment is shared.
 *
 * Browser-safe: no node imports, so the run dialog and the CLI can build the
 * same keys.
 */

/** The environment every SDK resolves when nothing names one. */
export const DEVELOPMENT_ENVIRONMENT = "development";

/** The longest environment name a row stores. */
export const MAX_ENVIRONMENT_LENGTH = 32;

/** The longest host label a row stores. */
export const MAX_HOST_LABEL_LENGTH = 64;

const ENVIRONMENT_PATTERN = /^[a-z0-9_-]+$/;

/**
 * An environment as the row stores it: lower case, `[a-z0-9_-]` only, at
 * most 32 characters. Runs of other characters become one dash, and the
 * result never starts or ends with one. Empty when nothing survives.
 */
export function sanitizeEnvironment(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ENVIRONMENT_LENGTH)
    .replace(/-+$/g, "");
}

/** Whether an environment, already sanitized, is one a row may store. */
export function isValidEnvironment(environment: string): boolean {
  return (
    environment.length > 0 &&
    environment.length <= MAX_ENVIRONMENT_LENGTH &&
    ENVIRONMENT_PATTERN.test(environment)
  );
}

/**
 * A host label from the hostname the SDK sends: the same rule the CLI's
 * device label follows, so a laptop reads the same from every SDK.
 */
export function sanitizeHostLabel(hostname: string): string {
  const label = hostname
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_HOST_LABEL_LENGTH)
    .replace(/-+$/g, "");
  return label.length > 0 ? label : "unknown-host";
}

/** Who a development agent belongs to; nothing for a shared environment. */
export type ConnectedAgentScope =
  | { kind: "shared" }
  | { kind: "owner"; userId: string }
  | { kind: "host"; hostLabel: string };

/**
 * The scope a register frame lands in.
 *
 * `development` with a key that names a person is that person's; with a
 * project or service key it is the host's. Any other environment is shared.
 */
export function deriveScope({
  environment,
  userId,
  hostname,
}: {
  environment: string;
  userId: string | null | undefined;
  hostname: string;
}): ConnectedAgentScope {
  if (environment !== DEVELOPMENT_ENVIRONMENT) return { kind: "shared" };
  if (userId) return { kind: "owner", userId };
  return { kind: "host", hostLabel: sanitizeHostLabel(hostname) };
}

/**
 * The key a register frame upserts by: `<name>@<environment>`, plus
 * `/user:<id>` or `/host:<label>` for a development agent.
 */
export function identityKeyOf({
  name,
  environment,
  scope,
}: {
  name: string;
  environment: string;
  scope: ConnectedAgentScope;
}): string {
  const base = `${name}@${environment}`;
  switch (scope.kind) {
    case "shared":
      return base;
    case "owner":
      return `${base}/user:${scope.userId}`;
    case "host":
      return `${base}/host:${scope.hostLabel}`;
  }
}

/** The columns a scope writes on the row. */
export function scopeColumns(scope: ConnectedAgentScope): {
  ownerUserId: string | null;
  hostLabel: string | null;
} {
  switch (scope.kind) {
    case "shared":
      return { ownerUserId: null, hostLabel: null };
    case "owner":
      return { ownerUserId: scope.userId, hostLabel: null };
    case "host":
      return { ownerUserId: null, hostLabel: scope.hostLabel };
  }
}

/**
 * What tells one connected agent row from another: the environment the SDK
 * resolved, the scope of a development agent, and the key that folds them.
 */
export type ConnectedAgentIdentity = {
  environment: string;
  ownerUserId: string | null;
  hostLabel: string | null;
  identityKey: string;
};

/**
 * A connected target reference as `<name>@<environment>`, or nothing when
 * the reference is an id. A name never holds `@`; an id never does either,
 * so the first `@` decides.
 */
export function parseConnectedReference(
  referenceId: string,
): { name: string; environment: string } | null {
  const at = referenceId.indexOf("@");
  if (at <= 0 || at === referenceId.length - 1) return null;
  const name = referenceId.slice(0, at);
  const environment = sanitizeEnvironment(referenceId.slice(at + 1));
  if (!isValidEnvironment(environment)) return null;
  return { name, environment };
}
