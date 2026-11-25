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

function derive({ keyPepper, label }: { keyPepper: string; label: string }): string {
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
  const [keyPepper] = findKeyPeppers(source);
  const credentials = resolveLwqlCredentials({
    clickHousePassword: source.LWQL_CLICKHOUSE_PASSWORD,
    postgresReaderPassword: source.LWQL_POSTGRES_READER_PASSWORD,
    accessModelMode: source.LWQL_ACCESS_MODEL_MODE,
    installMethod: source.INSTALL_METHOD,
    keyPepper,
  });
  if (!credentials.isDerived) return { ...source };

  return {
    ...source,
    LWQL_CLICKHOUSE_PASSWORD: credentials.clickHousePassword,
    LWQL_POSTGRES_READER_PASSWORD: credentials.postgresReaderPassword,
    LWQL_ACCESS_MODEL_MODE: credentials.accessModelMode,
    LWQL_CLICKHOUSE_USER: isSet(source.LWQL_CLICKHOUSE_USER)
      ? source.LWQL_CLICKHOUSE_USER
      : derivedRestrictedUser({ database: clickHouseDatabaseOf(source.CLICKHOUSE_URL) }),
  };
}
