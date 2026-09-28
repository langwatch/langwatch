/**
 * The wait for a ClickHouse that is still starting, driven with a fake ping
 * and a fake clock so no server is involved.
 *
 * @see ../goose.ts
 * @see ../../../../../../specs/clickhouse/boot-wait.feature
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CLICKHOUSE_WAIT_SECONDS,
  isConnectionError,
  MigrationError,
  readClickHouseWaitSeconds,
  redactUrl,
  waitForClickHouseReady,
} from "../goose";

const refused = () =>
  Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:8123"), {
    code: "ECONNREFUSED",
  });

/** A clock that moves only when the code under test sleeps. */
const fakeClock = () => {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
};

const SERVER_URL = "http://default:s3cret@clickhouse:8123/";

describe("waitForClickHouseReady", () => {
  describe("given ClickHouse refuses the first connections", () => {
    describe("when the server starts answering", () => {
      /** @scenario "A ClickHouse that starts accepting connections is waited for" */
      it("retries until the ping succeeds and logs without the password", async () => {
        const clock = fakeClock();
        const logs: string[] = [];
        let attempts = 0;

        await waitForClickHouseReady({
          displayUrl: redactUrl(SERVER_URL),
          waitSeconds: 180,
          ping: async () => {
            attempts += 1;
            if (attempts < 4) throw refused();
          },
          now: clock.now,
          sleep: clock.sleep,
          log: (message) => logs.push(message),
        });

        expect(attempts).toBe(4);
        expect(clock.sleeps).toHaveLength(3);
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0]).toContain(
          "Waiting for ClickHouse at http://clickhouse:8123/ to accept connections",
        );
        expect(logs.join("\n")).not.toContain("s3cret");
      });
    });
  });

  describe("given ClickHouse refuses every connection", () => {
    describe("when the configured wait passes", () => {
      /** @scenario "A ClickHouse that never comes up fails after the wait" */
      it("fails in the preflight phase naming the server and the setting", async () => {
        const clock = fakeClock();
        const logs: string[] = [];

        const error = await waitForClickHouseReady({
          displayUrl: redactUrl(SERVER_URL),
          waitSeconds: 60,
          ping: async () => {
            throw refused();
          },
          now: clock.now,
          sleep: clock.sleep,
          log: (message) => logs.push(message),
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(MigrationError);
        expect((error as MigrationError).phase).toBe("preflight");
        expect((error as MigrationError).message).toContain(
          "http://clickhouse:8123/",
        );
        expect((error as MigrationError).message).toContain(
          "CLICKHOUSE_MIGRATE_WAIT_SECONDS",
        );
        expect(clock.now()).toBe(60_000);
        // One line every ten seconds, not one per attempt.
        expect(logs).toHaveLength(6);
      });
    });
  });

  describe("given ClickHouse answers with an authentication failure", () => {
    describe("when the server is checked", () => {
      /** @scenario "A server that answers with an error is not retried" */
      it("fails on the first attempt", async () => {
        const clock = fakeClock();
        let attempts = 0;

        const error = await waitForClickHouseReady({
          displayUrl: redactUrl(SERVER_URL),
          waitSeconds: 180,
          ping: async () => {
            attempts += 1;
            throw Object.assign(
              new Error(
                "default: Authentication failed: password is incorrect",
              ),
              { code: "516", type: "AUTHENTICATION_FAILED" },
            );
          },
          now: clock.now,
          sleep: clock.sleep,
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(MigrationError);
        expect(attempts).toBe(1);
        expect(clock.sleeps).toHaveLength(0);
      });
    });
  });

  describe("given the wait is set to zero", () => {
    describe("when ClickHouse refuses the connection", () => {
      /** @scenario "A zero wait fails on the first refused connection" */
      it("fails on the first attempt", async () => {
        const clock = fakeClock();
        let attempts = 0;

        const error = await waitForClickHouseReady({
          displayUrl: redactUrl(SERVER_URL),
          waitSeconds: readClickHouseWaitSeconds("0"),
          ping: async () => {
            attempts += 1;
            throw refused();
          },
          now: clock.now,
          sleep: clock.sleep,
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(MigrationError);
        expect(attempts).toBe(1);
        expect(clock.sleeps).toHaveLength(0);
      });
    });
  });
});

describe("isConnectionError", () => {
  describe("when a dual-stack connect is refused on every address", () => {
    it("treats the AggregateError as a connection failure", () => {
      const error = new AggregateError([refused(), refused()], "");
      expect(isConnectionError(error)).toBe(true);
    });
  });

  describe("when the client's request times out", () => {
    it("treats it as a connection failure", () => {
      expect(isConnectionError(new Error("Timeout error."))).toBe(true);
    });
  });

  describe("when the server answered with an error", () => {
    it("does not treat it as a connection failure", () => {
      const error = Object.assign(new Error("Authentication failed"), {
        code: "516",
      });
      expect(isConnectionError(error)).toBe(false);
    });
  });
});

describe("readClickHouseWaitSeconds", () => {
  describe("when the variable is not set", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.CLICKHOUSE_MIGRATE_WAIT_SECONDS;
      delete process.env.CLICKHOUSE_MIGRATE_WAIT_SECONDS;
    });
    afterEach(() => {
      if (saved === undefined)
        delete process.env.CLICKHOUSE_MIGRATE_WAIT_SECONDS;
      else process.env.CLICKHOUSE_MIGRATE_WAIT_SECONDS = saved;
    });

    /** @scenario "An unset wait setting uses the default" */
    it("returns 180 seconds", () => {
      expect(readClickHouseWaitSeconds()).toBe(180);
      expect(DEFAULT_CLICKHOUSE_WAIT_SECONDS).toBe(180);
    });
  });

  describe("when the variable is not a non-negative number", () => {
    it("refuses it in the preflight phase", () => {
      expect(() => readClickHouseWaitSeconds("soon")).toThrow(MigrationError);
      expect(() => readClickHouseWaitSeconds("-5")).toThrow(MigrationError);
    });
  });
});

describe("redactUrl", () => {
  describe("when the credentials are in query params", () => {
    /** @scenario "Credentials in the ClickHouse URL never reach the log" */
    it("drops user and password params and keeps the rest", () => {
      const redacted = redactUrl(
        "http://clickhouse:8123/?user=default&Password=s3cret&database=langwatch",
      );
      expect(redacted).toBe("http://clickhouse:8123/?database=langwatch");
    });
  });

  describe("when the credentials are in the userinfo", () => {
    it("drops the user and password", () => {
      expect(redactUrl(SERVER_URL)).toBe("http://clickhouse:8123/");
    });
  });
});
