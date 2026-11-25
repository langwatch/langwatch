/**
 * @see modules/analytics/specs/analytics-lwql-default-credentials.feature
 */
import { describe, expect, it } from "vitest";

import {
  findKeyPeppers,
  resolveLwqlCredentials,
  withLwqlDefaultCredentials,
} from "../lwql-default-credentials.rules.ts";

const NONE = {
  clickHousePassword: undefined,
  postgresReaderPassword: undefined,
  accessModelMode: undefined,
  installMethod: undefined,
  keyPepper: undefined,
} as const;

describe("resolveLwqlCredentials", () => {
  /** @scenario "With no LangWatchQL passwords set, both are derived from the key pepper in SQL mode" */
  it("derives two distinct passwords in sql mode when none is set", () => {
    const source = { CREDENTIALS_SECRET: "credentials-secret" };

    const resolved = withLwqlDefaultCredentials(source);

    expect(resolved.LWQL_CLICKHOUSE_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.LWQL_POSTGRES_READER_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.LWQL_CLICKHOUSE_PASSWORD).not.toBe(resolved.LWQL_POSTGRES_READER_PASSWORD);
    expect(resolved.LWQL_ACCESS_MODEL_MODE).toBe("sql");
  });

  /** @scenario "The derived passwords are the same in every process" */
  it("derives the same passwords from the same pepper and others from another", () => {
    const api = resolveLwqlCredentials({ ...NONE, keyPepper: "pepper-a" });
    const worker = withLwqlDefaultCredentials({ API_KEY_PEPPER: "pepper-a" });
    const other = resolveLwqlCredentials({ ...NONE, keyPepper: "pepper-b" });

    expect(api.clickHousePassword).toBe(worker.LWQL_CLICKHOUSE_PASSWORD);
    expect(api.postgresReaderPassword).toBe(worker.LWQL_POSTGRES_READER_PASSWORD);
    expect(other.clickHousePassword).not.toBe(api.clickHousePassword);
    expect(other.postgresReaderPassword).not.toBe(api.postgresReaderPassword);
  });

  /** @scenario "The key pepper is the first of API_KEY_PEPPER, CREDENTIALS_SECRET and NEXTAUTH_SECRET that is set" */
  it("takes the first set pepper source, skipping an empty one", () => {
    const source = { API_KEY_PEPPER: "", NEXTAUTH_SECRET: "session-secret" };

    expect(findKeyPeppers(source)).toEqual(["session-secret"]);
    expect(withLwqlDefaultCredentials(source).LWQL_CLICKHOUSE_PASSWORD).toBe(
      resolveLwqlCredentials({ ...NONE, keyPepper: "session-secret" }).clickHousePassword,
    );
  });

  /** @scenario "A derived install signs in as one restricted user per ClickHouse database" */
  it("names the restricted user after the ClickHouse database and keeps an explicit one", () => {
    const pepper = { CREDENTIALS_SECRET: "credentials-secret" };

    expect(
      withLwqlDefaultCredentials({
        ...pepper,
        CLICKHOUSE_URL: "http://default:pw@localhost:8123/langwatch_dev",
      }).LWQL_CLICKHOUSE_USER,
    ).toBe("langwatch_dev_lwql");
    expect(
      withLwqlDefaultCredentials({
        ...pepper,
        CLICKHOUSE_URL: "http://default:pw@clickhouse:8123/langwatch",
      }).LWQL_CLICKHOUSE_USER,
    ).toBe("langwatch_lwql");
    expect(
      withLwqlDefaultCredentials({
        ...pepper,
        CLICKHOUSE_URL: "http://default:pw@clickhouse:8123/langwatch",
        LWQL_CLICKHOUSE_USER: "custom_reader",
      }).LWQL_CLICKHOUSE_USER,
    ).toBe("custom_reader");
  });

  /** @scenario "Explicit LangWatchQL passwords are used as given" */
  it("uses explicit passwords and the configured mode as given", () => {
    const resolved = resolveLwqlCredentials({
      ...NONE,
      clickHousePassword: "explicit-ch",
      postgresReaderPassword: "explicit-pg",
      keyPepper: "pepper",
    });

    expect(resolved).toEqual({
      clickHousePassword: "explicit-ch",
      postgresReaderPassword: "explicit-pg",
      accessModelMode: undefined,
      isDerived: false,
    });
    expect(
      resolveLwqlCredentials({
        ...NONE,
        clickHousePassword: "explicit-ch",
        postgresReaderPassword: "explicit-pg",
        accessModelMode: "sql",
      }).accessModelMode,
    ).toBe("sql");
  });

  /** @scenario "One explicit password and one missing stays partially configured" */
  it("derives nothing when only one password is set", () => {
    const resolved = withLwqlDefaultCredentials({
      LWQL_CLICKHOUSE_PASSWORD: "explicit-ch",
      CREDENTIALS_SECRET: "credentials-secret",
    });

    expect(resolved.LWQL_CLICKHOUSE_PASSWORD).toBe("explicit-ch");
    expect(resolved.LWQL_POSTGRES_READER_PASSWORD).toBeUndefined();
    expect(resolved.LWQL_ACCESS_MODEL_MODE).toBeUndefined();
  });

  /** @scenario "A Helm install derives nothing" */
  it("leaves a Helm install without passwords off", () => {
    const resolved = withLwqlDefaultCredentials({
      INSTALL_METHOD: "helm",
      CREDENTIALS_SECRET: "credentials-secret",
    });

    expect(resolved.LWQL_CLICKHOUSE_PASSWORD).toBeUndefined();
    expect(resolved.LWQL_POSTGRES_READER_PASSWORD).toBeUndefined();
  });

  /** @scenario "An explicit access model mode wins over the derived default" */
  it("keeps an explicit mode on derived passwords", () => {
    const resolved = resolveLwqlCredentials({
      ...NONE,
      accessModelMode: "rendered",
      keyPepper: "pepper",
    });

    expect(resolved.isDerived).toBe(true);
    expect(resolved.accessModelMode).toBe("rendered");
  });

  /** @scenario "With no key pepper at all, nothing is derived" */
  it("derives nothing without a key pepper", () => {
    expect(resolveLwqlCredentials(NONE)).toEqual({
      clickHousePassword: undefined,
      postgresReaderPassword: undefined,
      accessModelMode: undefined,
      isDerived: false,
    });
  });
});
