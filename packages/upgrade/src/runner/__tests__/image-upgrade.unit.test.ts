/**
 * The image's upgrade composition: its ClickHouse reader, goose options, lines and upcasts.
 * @see specs/upgrade/upgrade-command.feature
 * @see specs/upgrade/stepping.feature
 */
import { type ClickHouseClient, ClickHouseError } from "@clickhouse/client";
import { describe, expect, it } from "vitest";

import {
  clickHouseRunOptions,
  closingLines,
  configuredClickHouseTargets,
  PRIVATE_TARGET_WAIT_SECONDS,
  noClickHouseLine,
  sqlReader,
  upcastStepsOf,
} from "../image-upgrade.ts";
import { upgradeOutcome } from "../upgrade-outcome.ts";

/** A ClickHouse client whose every query fails with the server error given. */
function failingClient({ code, type }: { code: string; type: string }) {
  const query: ClickHouseClient["query"] = () =>
    Promise.reject(new ClickHouseError({ message: `${type} from the server`, code, type }));
  return { query };
}

describe("the upgrade's ClickHouse reader", () => {
  /** @scenario "A ClickHouse database goose has not created yet reads as holding no goose history" */
  it("reads a database that does not exist yet as empty and fails on any other server error", async () => {
    const missing = sqlReader({ client: failingClient({ code: "81", type: "UNKNOWN_DATABASE" }) });
    await expect(missing.queryRows("SELECT 1")).resolves.toEqual([]);

    const denied = sqlReader({ client: failingClient({ code: "497", type: "ACCESS_DENIED" }) });
    await expect(denied.queryRows("SELECT 1")).rejects.toMatchObject({ code: "497" });
  });
});

describe("the upgrade task's closing lines", () => {
  const done = upgradeOutcome({ code: "done", message: "upgraded to 3.21.0", runId: "run_1" });

  describe("when BASE_HOST is set", () => {
    /** @scenario "The upgrade task's last line names the UI and what upgrade status shows" */
    it("names the UI's address and the status command on the last line", () => {
      const lines = closingLines({ outcome: done, baseHost: "https://langwatch.example.test" });
      expect(lines.at(-1)?.message).toContain("https://langwatch.example.test");
      expect(lines.at(-1)?.message).toContain("pnpm task upgrade status");
    });
  });

  describe("when BASE_HOST is not set", () => {
    /** @scenario "The upgrade task with no BASE_HOST says which variable sets the UI's address" */
    it("names BASE_HOST and the status command on the last line", () => {
      const lines = closingLines({ outcome: done, baseHost: undefined });
      expect(lines.at(-1)?.message).toContain("BASE_HOST");
      expect(lines.at(-1)?.message).toContain("pnpm task upgrade status");
    });
  });

  describe("when the run failed with a credential in its detail", () => {
    it("logs the failure as an error with its next action and without the password", () => {
      const failed = upgradeOutcome({
        code: "schema_failed",
        message: "schema failed on postgres (postgresql://lw:hunter2@db/lw)",
        detail: { targets: [{ target: "postgres", error: "postgresql://lw:hunter2@db/lw" }] },
      });
      const [first] = closingLines({ outcome: failed, baseHost: undefined });
      expect(first).toMatchObject({ level: "error", fields: { code: "schema_failed" } });
      expect(first?.fields.next).toContain("pnpm task upgrade");
      expect(JSON.stringify(first)).not.toContain("hunter2");
    });
  });
});

describe("the upgrade task with no ClickHouse target", () => {
  /** @scenario "The upgrade task with no ClickHouse target names CLICKHOUSE_URL before it starts" */
  it("warns that the api and worker refuse to serve until CLICKHOUSE_URL is set", () => {
    const line = noClickHouseLine();
    expect(line.level).toBe("warn");
    expect(line.message).toContain("CLICKHOUSE_URL");
    expect(line.fields.next).toContain("CLICKHOUSE_URL");
  });
});

describe("the upgrade's declared upcast steps", () => {
  describe("when the tasks process holds an event log", () => {
    /** @scenario "The upgrade reads each declared upcast from the booted tasks process" */
    it("answers each upcast's step id and stored events, with the rest as its report", async () => {
      const upcasts = upcastStepsOf({
        app: {
          upcastReader: () => ({
            findActiveUpcasts: async () => [
              {
                id: "upcast:entitlement:lw.usage.month_counted",
                pipeline: "entitlement",
                from: "lw.usage.month_counted",
                fromAggregateType: null,
                to: "lw.usage.month_metered",
                drainsFrom: null,
                storedEvents: 3,
              },
            ],
          }),
        },
      });

      expect(await upcasts()).toEqual([
        {
          id: "upcast:entitlement:lw.usage.month_counted",
          storedEvents: 3,
          report: {
            pipeline: "entitlement",
            from: "lw.usage.month_counted",
            fromAggregateType: null,
            to: "lw.usage.month_metered",
            drainsFrom: null,
          },
        },
      ]);
    });
  });

  describe("when the tasks process holds no event log", () => {
    /** @scenario "A tasks process without an event log hands the upgrade no upcast steps" */
    it("answers none", async () => {
      const upcasts = upcastStepsOf({ app: { upcastReader: () => undefined } });

      expect(await upcasts()).toEqual([]);
    });
  });
});

describe("configuredClickHouseTargets()", () => {
  it("names the shared route first and each private route by its organisation", () => {
    const environment = {
      CLICKHOUSE_URL: "http://clickhouse:8123/langwatch",
      CLICKHOUSE_URL__acme__org_1: "http://acme:8123/langwatch",
      CLICKHOUSE_URL__globex__org_2: "http://globex:8123/langwatch",
    };
    expect(configuredClickHouseTargets({ environment })).toEqual([
      "shared",
      "private:org_1",
      "private:org_2",
    ]);
  });

  it("drops a private route that points at the shared ClickHouse", () => {
    const url = "http://clickhouse:8123/langwatch";
    const environment = { CLICKHOUSE_URL: url, CLICKHOUSE_URL__acme__org_1: url };
    expect(configuredClickHouseTargets({ environment })).toEqual(["shared"]);
  });

  it("names nothing at build time or with no route at all", () => {
    expect(configuredClickHouseTargets({ environment: {} })).toEqual([]);
    expect(
      configuredClickHouseTargets({
        environment: { BUILD_TIME: "1", CLICKHOUSE_URL: "http://clickhouse:8123/langwatch" },
      }),
    ).toEqual([]);
  });
});

describe("clickHouseRunOptions()", () => {
  const settings = { clusterName: undefined, childEnvironment: {}, waitSeconds: 5 };

  /** @scenario "A stepped release migrates ClickHouse up to its own last goose version" */
  it("carries the release's goose version when stepping and none in one pass", () => {
    const url = "http://clickhouse:8123/langwatch";
    expect(clickHouseRunOptions({ url, settings, upTo: 2, signal: undefined }).upTo).toBe(2);
    expect(clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined })).toEqual({
      connectionUrl: url,
      clusterName: undefined,
      childEnvironment: {},
      waitSeconds: 5,
      verbose: true,
    });
    expect(
      "upTo" in clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined }),
    ).toBe(false);
  });

  /** @scenario "A private ClickHouse target is waited for briefly before it is held" */
  it("waits the full connect wait only for the shared target", () => {
    const url = "http://clickhouse:8123/langwatch";
    const configured = { ...settings, waitSeconds: 180 };
    const waitFor = (options: { waitSeconds: number; privateTarget: boolean }) =>
      clickHouseRunOptions({
        url,
        settings: { ...settings, waitSeconds: options.waitSeconds },
        upTo: undefined,
        signal: undefined,
        privateTarget: options.privateTarget,
      }).waitSeconds;

    expect(
      clickHouseRunOptions({ url, settings: configured, upTo: undefined, signal: undefined })
        .waitSeconds,
    ).toBe(180);
    expect(waitFor({ waitSeconds: 180, privateTarget: true })).toBe(PRIVATE_TARGET_WAIT_SECONDS);
    expect(PRIVATE_TARGET_WAIT_SECONDS).toBe(5);
    expect(waitFor({ waitSeconds: 0, privateTarget: true })).toBe(0);
    expect(waitFor({ waitSeconds: 0, privateTarget: false })).toBe(0);
  });
});
