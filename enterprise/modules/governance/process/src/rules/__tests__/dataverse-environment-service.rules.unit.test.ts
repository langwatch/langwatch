import { describe, expect, it } from "vitest";

import {
  isEnvironmentOrigin,
  isSameEnvironment,
} from "../../features/microsoft/rules/dataverse-environment-service.rules.ts";

const configuredBase = "http://localhost:6970/dataverse";

describe("isEnvironmentOrigin()", () => {
  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it("refuses a non-Dataverse host when no base is configured", () => {
    expect(isEnvironmentOrigin(configuredBase)).toBe(false);
    expect(isEnvironmentOrigin("https://org.crm.dynamics.com")).toBe(true);
  });

  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it("accepts the configured base, with or without a trailing slash", () => {
    expect(isEnvironmentOrigin(configuredBase, configuredBase)).toBe(true);
    expect(isEnvironmentOrigin(`${configuredBase}/`, configuredBase)).toBe(true);
  });

  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it.each([
    "http://localhost:6971/dataverse",
    "http://127.0.0.1:6970/dataverse",
    "https://localhost:6970/dataverse",
    "http://localhost:6970",
    "http://localhost:6970/dataverse/other",
    "http://localhost:6970/dataverse?x=1",
    "http://user:pass@localhost:6970/dataverse",
  ])("still refuses %s beside a configured base", (value) => {
    expect(isEnvironmentOrigin(value, configuredBase)).toBe(false);
  });
});

describe("isSameEnvironment()", () => {
  const environmentUrl = configuredBase;

  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it("follows a next link off the configured origin from a source on it", () => {
    const value = "http://localhost:6970/dataverse/api/data/v9.2/bots?$skiptoken=3";
    expect(isSameEnvironment({ value, environmentUrl, configuredBase })).toBe(true);
  });

  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it("refuses that link when no base is configured", () => {
    const value = "http://localhost:6970/dataverse/api/data/v9.2/bots?$skiptoken=3";
    expect(isSameEnvironment({ value, environmentUrl })).toBe(false);
  });

  /** @scenario "Dataverse accepts the configured environment base and nothing wider" */
  it.each([
    "http://localhost:6971/dataverse/api/data/v9.2/bots",
    "http://evil.test/api/data/v9.2/bots",
    "https://other.crm.dynamics.com/api/data/v9.2/bots",
    "http://user:pass@localhost:6970/dataverse/api",
  ])("still refuses the link %s", (value) => {
    expect(isSameEnvironment({ value, environmentUrl, configuredBase })).toBe(false);
  });

  it("still refuses a link off the configured origin from a real environment", () => {
    expect(
      isSameEnvironment({
        value: "http://localhost:6970/dataverse/api/data/v9.2/bots",
        environmentUrl: "https://org.crm.dynamics.com",
        configuredBase,
      }),
    ).toBe(false);
  });

  it("keeps the real rule: another tenant's environment is refused", () => {
    expect(
      isSameEnvironment({
        value: "https://other.crm.dynamics.com/api",
        environmentUrl: "https://org.crm.dynamics.com",
        configuredBase,
      }),
    ).toBe(false);
  });
});

describe("isEnvironmentOrigin() with an http IP-literal base", () => {
  const ipBase = "http://127.0.0.1:6970/dataverse";

  it("accepts the configured base and refuses another 127.0.0.1 address", () => {
    expect(isEnvironmentOrigin(ipBase, ipBase)).toBe(true);
    expect(isEnvironmentOrigin("http://127.0.0.1:6971/dataverse", ipBase)).toBe(false);
    expect(isEnvironmentOrigin(ipBase)).toBe(false);
  });
});
