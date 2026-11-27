/**
 * The LangWatchQL passwords an install uses when it sets none: derived from the key pepper, so
 * `pnpm dev` and docker compose get a working restricted identity with no extra setting.
 * @see modules/analytics/specs/analytics-lwql-default-credentials.feature
 */
import { createHmac } from "node:crypto";

/** What a password is derived under; changing one rotates that password on every install. */
const DERIVATION_LABELS = {
  clickHouse: "langwatch:lwql:clickhouse-password:v1",
  postgresReader: "langwatch:lwql:postgres-reader-password:v1",
} as const;

/** The key pepper's sources, first set wins, as `intoKeyPepper` reads them. */
const KEY_PEPPER_SOURCES = ["API_KEY_PEPPER", "CREDENTIALS_SECRET", "NEXTAUTH_SECRET"] as const;

/**
 * The secrets the task's environment must carry for it to derive what the api and worker derive
 * through their secrets chain: a runner overlays each from that chain before the task runs.
 */
export const LWQL_CREDENTIAL_SECRETS = [
  "LWQL_CLICKHOUSE_PASSWORD",
  "LWQL_POSTGRES_READER_PASSWORD",
  ...KEY_PEPPER_SOURCES,
] as const;

export interface LwqlCredentialInputs {
  readonly clickHousePassword: string | undefined;
  readonly postgresReaderPassword: string | undefined;
  readonly accessModelMode: string | undefined;
  readonly installMethod: string | undefined;
  readonly keyPepper: string | undefined;
}

export interface LwqlCredentials {
  readonly clickHousePassword: string | undefined;
  readonly postgresReaderPassword: string | undefined;
  readonly accessModelMode: string | undefined;
  /** The passwords came from the key pepper, not from the environment. */
  readonly isDerived: boolean;
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export function derive({ keyPepper, label }: { keyPepper: string; label: string }): string {
  return createHmac("sha256", keyPepper).update(label).digest("hex");
}

/**
 * Explicit passwords win, one alone stays partial. With neither, a Helm install stays off (the
 * chart hands both whenever `lwql.enabled`), any other derives both from the key pepper and
 * provisions in `sql` mode unless a mode is set: nothing renders ClickHouse config there.
 */
export function resolveLwqlCredentials(inputs: LwqlCredentialInputs): LwqlCredentials {
  const { keyPepper } = inputs;
  const clickHousePassword = isSet(inputs.clickHousePassword) ? inputs.clickHousePassword : void 0;
  const postgresReaderPassword = isSet(inputs.postgresReaderPassword)
    ? inputs.postgresReaderPassword
    : void 0;
  const accessModelMode = isSet(inputs.accessModelMode) ? inputs.accessModelMode : void 0;
  const isExplicit = clickHousePassword !== void 0 || postgresReaderPassword !== void 0;

  if (isExplicit || inputs.installMethod === "helm" || !isSet(keyPepper)) {
    return { clickHousePassword, postgresReaderPassword, accessModelMode, isDerived: false };
  }

  return {
    clickHousePassword: derive({ keyPepper, label: DERIVATION_LABELS.clickHouse }),
    postgresReaderPassword: derive({ keyPepper, label: DERIVATION_LABELS.postgresReader }),
    accessModelMode: accessModelMode ?? "sql",
    isDerived: true,
  };
}

/** Every key pepper source a raw environment sets, in the order the first one wins. */
export function findKeyPeppers(source: Readonly<Record<string, string | undefined>>): string[] {
  return KEY_PEPPER_SOURCES.map((name) => source[name]).filter(isSet);
}

/**
 * The restricted user a derived install signs in as: one per ClickHouse database, since users are
 * server-wide and two stacks on one server must not repoint each other's. `langwatch_lwql` for the
 * default `langwatch` database.
 */
export function derivedRestrictedUser({ database }: { database: string }): string {
  return `${database}_lwql`;
}

function clickHouseDatabaseOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").pathname.replace(/^\/+/, "").split("/")[0] || "default";
  } catch {
    return "default";
  }
}

/** A raw environment with the resolved LangWatchQL passwords and mode filled in, for the task. */
export function withLwqlDefaultCredentials(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return resolveLwqlSource(source).source;
}

/** {@link withLwqlDefaultCredentials}, saying whether the passwords were derived. */
export function resolveLwqlSource(source: Readonly<Record<string, string | undefined>>): {
  source: Record<string, string | undefined>;
  isDerived: boolean;
} {
  const [keyPepper] = findKeyPeppers(source);
  const credentials = resolveLwqlCredentials({
    clickHousePassword: source.LWQL_CLICKHOUSE_PASSWORD,
    postgresReaderPassword: source.LWQL_POSTGRES_READER_PASSWORD,
    accessModelMode: source.LWQL_ACCESS_MODEL_MODE,
    installMethod: source.INSTALL_METHOD,
    keyPepper,
  });
  if (!credentials.isDerived) return { source: { ...source }, isDerived: false };

  const derived = {
    ...source,
    LWQL_CLICKHOUSE_PASSWORD: credentials.clickHousePassword,
    LWQL_POSTGRES_READER_PASSWORD: credentials.postgresReaderPassword,
    LWQL_ACCESS_MODEL_MODE: credentials.accessModelMode,
    LWQL_CLICKHOUSE_USER: isSet(source.LWQL_CLICKHOUSE_USER)
      ? source.LWQL_CLICKHOUSE_USER
      : derivedRestrictedUser({ database: clickHouseDatabaseOf(source.CLICKHOUSE_URL) }),
  };
  return { source: derived, isDerived: true };
}

const CLICKHOUSE_ACCESS_DENIED = 497;
const CLICKHOUSE_UNKNOWN_SETTING = 115;
const POSTGRES_INSUFFICIENT_PRIVILEGE = "42501";
const CLICKHOUSE_MISSING_GRANT =
  /necessary to have the grant ([A-Z][A-Z_ ,]*[A-Z](?:\([\w, ]*\))? ON [\w`*.]*[\w`*])/;
const CLICKHOUSE_UNPREFIXED_SETTING = /Setting (\w+) is neither a builtin setting nor started with/;
const POSTGRES_MISSING_GRANT = /permission denied (?:to|for) ([\w ]+)/;

/** Why provisioning failed, in words an operator can act on; the message is read only for names. */
export interface LwqlSetupFailure {
  readonly kind: "missing_grant" | "custom_settings_prefix" | "other";
  readonly store: "clickhouse" | "postgres" | "unknown";
  readonly reason: string;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current && chain.length < 4;) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function otherFailure(summary: string): LwqlSetupFailure {
  return { kind: "other", store: "unknown", reason: `provisioning failed (${summary})` };
}

/** One error's known setup gap, or kind "other" when it is none of them. */
function setupFailureOf({ error, summary }: { error: unknown; summary: string }): LwqlSetupFailure {
  const failure = error as { code?: unknown; meta?: { code?: unknown } } | null;
  const message = messageOf(error);
  const clickHouseCode = Number(failure?.code);
  if (clickHouseCode === CLICKHOUSE_ACCESS_DENIED || /Not enough privileges/.test(message)) {
    const grant = CLICKHOUSE_MISSING_GRANT.exec(message)?.[1] ?? "access management";
    return {
      kind: "missing_grant",
      store: "clickhouse",
      reason: `the ClickHouse user lacks the grant ${grant}`,
    };
  }
  const setting = CLICKHOUSE_UNPREFIXED_SETTING.exec(message)?.[1];
  if (clickHouseCode === CLICKHOUSE_UNKNOWN_SETTING || setting !== undefined) {
    return {
      kind: "custom_settings_prefix",
      store: "clickhouse",
      reason: `the ClickHouse server does not accept the setting ${setting ?? "custom_api_key_hash"}: add custom_ to custom_settings_prefixes in its config and restart it`,
    };
  }
  if (
    failure?.meta?.code === POSTGRES_INSUFFICIENT_PRIVILEGE ||
    failure?.code === POSTGRES_INSUFFICIENT_PRIVILEGE
  ) {
    const grant = POSTGRES_MISSING_GRANT.exec(message)?.[1]?.trim() ?? "create role";
    return {
      kind: "missing_grant",
      store: "postgres",
      reason: `the PostgreSQL user has no permission to ${grant} (CREATEROLE)`,
    };
  }
  return otherFailure(summary);
}

/** Classifies a provisioning failure: a missing grant, a missing settings prefix, or other. */
export function classifyLwqlSetupFailure({
  error,
  summary,
}: {
  error: unknown;
  /** The loggable code and type, said when the failure is none of the known setup gaps. */
  summary: string;
}): LwqlSetupFailure {
  for (const link of errorChain(error)) {
    const failure = setupFailureOf({ error: link, summary });
    if (failure.kind !== "other") return failure;
  }
  return otherFailure(summary);
}
