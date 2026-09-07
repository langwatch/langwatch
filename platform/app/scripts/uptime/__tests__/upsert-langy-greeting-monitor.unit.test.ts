/**
 * @vitest-environment node
 *
 * scripts/uptime/upsert-langy-greeting-monitor.ts — payload shape, the
 * create/update/ambiguous decision, dry run, and API refusals.
 *
 * Spec: specs/langy/langy-uptime-greeting-monitor.feature
 */

import { describe, expect, it } from "vitest";
import {
  type ApiFetch,
  BETTERSTACK_API_BASE,
  buildMonitorPayload,
  configFromEnv,
  MONITOR_REQUEST_TIMEOUT_SECONDS,
  type MonitorConfig,
  ProvisioningError,
  REDACTED,
  readMonitorScript,
  redactPayload,
  upsertMonitor,
} from "../upsert-langy-greeting-monitor";

const config: MonitorConfig = {
  name: "Langy greeting",
  region: "eu",
  checkFrequencySeconds: 180,
  langyBaseUrl: "https://langwatch.example",
  langyApiKey: "sk-lw-service-key-DO-NOT-LOG",
};
const script =
  'import { test } from "@playwright/test";\ntest("x", async () => {});\n';

type Call = { method: string; path: string; body?: unknown };

function fakeApi(options: {
  existing: Array<{ id: string; name: string }>;
  writeStatus?: number;
  writeBody?: unknown;
}) {
  const calls: Call[] = [];
  const fetch: ApiFetch = async (url, init) => {
    const path = url.replace(BETTERSTACK_API_BASE, "");
    calls.push({
      method: init.method,
      path,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    if (init.method === "GET") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            data: options.existing.map((m) => ({
              id: m.id,
              type: "monitor",
              attributes: { pronounceable_name: m.name },
            })),
            pagination: { next: null },
          }),
      };
    }
    return {
      status: options.writeStatus ?? (init.method === "POST" ? 201 : 200),
      text: async () =>
        JSON.stringify(
          options.writeBody ?? {
            data: {
              id:
                init.method === "POST" ? "900" : path.replace("/monitors/", ""),
            },
          },
        ),
    };
  };
  return { fetch, calls };
}

describe("buildMonitorPayload", () => {
  describe("given a config and the script", () => {
    /** @scenario The monitor payload is a single-region Playwright monitor bounded under its own frequency */
    it("builds a playwright monitor with the script, env vars, one region and timeout <= frequency", () => {
      const payload = buildMonitorPayload({ config, script });
      expect(payload.monitor_type).toBe("playwright");
      expect(payload.playwright_script).toBe(script);
      expect(payload.scenario_name).toBe("Langy greeting");
      expect(payload.pronounceable_name).toBe("Langy greeting");
      expect(payload.environment_variables).toEqual({
        LANGY_BASE_URL: "https://langwatch.example",
        LANGY_API_KEY: "sk-lw-service-key-DO-NOT-LOG",
      });
      expect(payload.playwright_script).not.toContain("sk-lw-service-key");
      expect(payload.regions).toEqual(["eu"]);
      expect(payload.request_timeout).toBe(MONITOR_REQUEST_TIMEOUT_SECONDS);
      expect(payload.request_timeout).toBeLessThanOrEqual(
        payload.check_frequency,
      );
      expect(payload).not.toHaveProperty("team_name");
      expect(
        buildMonitorPayload({ config: { ...config, teamName: "ops" }, script })
          .team_name,
      ).toBe("ops");
    });

    /** @scenario An unknown region or a timeout above the frequency is refused before any API call */
    it("refuses a bad region or a frequency under the timeout, naming the field", () => {
      expect(() =>
        buildMonitorPayload({ config: { ...config, region: "mars" }, script }),
      ).toThrow(/region "mars"/);
      expect(() =>
        buildMonitorPayload({
          config: { ...config, checkFrequencySeconds: 30 },
          script,
        }),
      ).toThrow(/checkFrequencySeconds \(30\)/);
      expect(() =>
        buildMonitorPayload({ config: { ...config, langyApiKey: "" }, script }),
      ).toThrow(ProvisioningError);
      expect(() =>
        buildMonitorPayload({
          config: { ...config, langyBaseUrl: "http://app.example.com" },
          script,
        }),
      ).toThrow(/must use https/);
      expect(() => buildMonitorPayload({ config, script: "  " })).toThrow(
        /script is empty/,
      );
    });

    it("reads defaults from the environment", () => {
      expect(
        configFromEnv({
          LANGY_BASE_URL: "https://x",
          LANGY_API_KEY: "k",
        } as NodeJS.ProcessEnv),
      ).toEqual({
        name: "Langy greeting",
        region: "eu",
        checkFrequencySeconds: 180,
        langyBaseUrl: "https://x",
        langyApiKey: "k",
      });
    });

    it("reads the real script file and it is the Better Stack script", () => {
      expect(readMonitorScript()).toContain('from "@playwright/test"');
    });
  });
});

describe("upsertMonitor", () => {
  describe("when the monitor is looked up by name", () => {
    /** @scenario A monitor that does not exist yet is created */
    it("creates when no monitor carries the name", async () => {
      const { fetch, calls } = fakeApi({ existing: [] });
      const result = await upsertMonitor({
        fetch,
        token: "t",
        config,
        script,
        isDryRun: false,
        log: () => {},
      });
      expect(result).toEqual({
        action: "created",
        id: "900",
        dashboardUrl: "https://uptime.betterstack.com/team/monitors/900",
      });
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        "GET /monitors?pronounceable_name=Langy+greeting",
        "POST /monitors",
      ]);
      expect(calls[1]?.body).toMatchObject({
        monitor_type: "playwright",
        regions: ["eu"],
      });
    });

    /** @scenario A monitor that already exists is updated in place, never duplicated */
    it("patches the one existing monitor and posts nothing", async () => {
      const { fetch, calls } = fakeApi({
        existing: [
          { id: "41", name: "Langy greeting" },
          { id: "42", name: "Langy greeting (staging)" },
        ],
      });
      const result = await upsertMonitor({
        fetch,
        token: "t",
        config,
        script,
        isDryRun: false,
        log: () => {},
      });
      expect(result).toMatchObject({ action: "updated", id: "41" });
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        "GET /monitors?pronounceable_name=Langy+greeting",
        "PATCH /monitors/41",
      ]);
    });

    /** @scenario Two monitors with the configured name is an error, not a coin flip */
    it("refuses to choose between two monitors with the same name and writes nothing", async () => {
      const { fetch, calls } = fakeApi({
        existing: [
          { id: "41", name: "Langy greeting" },
          { id: "43", name: "Langy greeting" },
        ],
      });
      await expect(
        upsertMonitor({
          fetch,
          token: "t",
          config,
          script,
          isDryRun: false,
          log: () => {},
        }),
      ).rejects.toThrow(/2 monitors are named "Langy greeting" \(ids 41, 43\)/);
      expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    });

    /** @scenario A dry run shows the payload with the credential redacted and writes nothing */
    it("prints the redacted payload and sends no write", async () => {
      const { fetch, calls } = fakeApi({
        existing: [{ id: "41", name: "Langy greeting" }],
      });
      const lines: string[] = [];
      const result = await upsertMonitor({
        fetch,
        token: "t",
        config,
        script,
        isDryRun: true,
        log: (line) => lines.push(line),
      });
      expect(result).toEqual({
        action: "dry-run",
        id: "41",
        dashboardUrl: null,
      });
      expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
      const output = lines.join("\n");
      expect(output).toContain("would update monitor 41");
      expect(output).toContain(REDACTED);
      expect(output).not.toContain("sk-lw-service-key");
      expect(output).not.toContain("@playwright/test");
      expect(
        redactPayload(buildMonitorPayload({ config, script }))
          .environment_variables,
      ).toEqual({
        LANGY_BASE_URL: "https://langwatch.example",
        LANGY_API_KEY: REDACTED,
      });
    });

    /** @scenario A refusal from the monitoring API surfaces its status and message */
    it("carries the API's status and error body on a refused write", async () => {
      const { fetch } = fakeApi({
        existing: [],
        writeStatus: 422,
        writeBody: {
          errors: {
            base: ["Request timeout must be less than check frequency"],
          },
        },
      });
      const error = await upsertMonitor({
        fetch,
        token: "t",
        config,
        script,
        isDryRun: false,
        log: () => {},
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProvisioningError);
      expect((error as ProvisioningError).status).toBe(422);
      expect((error as ProvisioningError).message).toContain(
        "POST /monitors answered 422",
      );
      expect((error as ProvisioningError).message).toContain(
        "Request timeout must be less",
      );
    });
  });
});
