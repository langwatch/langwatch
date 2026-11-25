/**
 * `langwatch doctor` asks the install and prints what it says.
 *
 * Spec: sdks/typescript/specs/cli/doctor.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "http://localhost:5560",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    text: "",
  }),
}));

import { setOutputFormat } from "../../utils/outputScope";
import { doctorCommand, type DoctorReport } from "../doctor";

class ProcessExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function report(): DoctorReport {
  return {
    ranAt: "2026-09-21T10:00:00.000Z",
    rows: [
      {
        id: "app",
        name: "Application",
        group: "install",
        cost: "free",
        verdict: { outcome: "verified", detail: "Release 2026.9.3." },
      },
      {
        id: "redis",
        name: "Redis",
        group: "install",
        cost: "free",
        verdict: {
          outcome: "refused",
          code: "checkup_redis_unreachable",
          detail: "Redis did not answer at redis://cache:6379.",
          fix: "Check REDIS_URL.",
          docsPath: "/self-hosting/troubleshooting",
        },
      },
      {
        id: "reach_connect_host",
        name: "Reach the connect host",
        group: "langwatch",
        cost: "egress",
        verdict: { outcome: "unchecked", detail: "Not run." },
      },
    ],
    usageReport: {
      payload: { event: "daily_usage_stats", instance_id: "4b1c" },
      switches: { optional: true, hostname: true },
      endpoint: "https://connect.langwatch.ai/v1/stats",
      disabled: false,
      schemaVersion: 2,
      nextReportAt: "2026-09-21T12:00:00.000Z",
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("langwatch doctor", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logs: string[];

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number | undefined);
    });
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
    setOutputFormat("table");
  });

  describe("given the CLI is pointed at a self-hosted install with a project API key", () => {
    /** @scenario "The cheap checks print one line per row with the verdict" */
    it("prints one line per row with PASS, FAIL or NOT CHECKED and the fix under a fail", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(report()));

      const result = await doctorCommand({});
      result?.table();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:5560/api/checkup");
      const output = logs.join("\n");
      expect(output).toMatch(/PASS.*Application/);
      expect(output).toMatch(/FAIL.*Redis/);
      expect(output).toMatch(/NOT CHECKED.*Reach the connect host/);
      expect(output).toContain("Fix: Check REDIS_URL.");
      expect(output).toContain("https://docs.langwatch.ai/self-hosting/troubleshooting");
    });

    /** @scenario "A project key reads the verdicts and its organization's figures" */
    it("prints each verdict without a detail line and the organization's figures", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ranAt: "2026-09-21T10:00:00.000Z",
          rows: report().rows.map(({ verdict, ...row }) => ({
            ...row,
            verdict: { outcome: verdict.outcome },
          })),
          usageReport: { payload: { event: "daily_usage_stats", projects: 1 }, schemaVersion: 3 },
        }),
      );

      const result = await doctorCommand({});
      result?.table();

      const output = logs.join("\n");
      expect(output).toMatch(/FAIL.*Redis/);
      expect(output).not.toContain("undefined");
      expect(output).not.toContain("Fix:");
      expect(output).toContain("What this organization adds to the install's usage report");
      expect(output).toContain('"projects": 1');
    });

    /** @scenario "The explicit checks run only when asked for" */
    it("posts to /api/checkup/run only with --run", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(report()));
      await doctorCommand({});
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(jsonResponse(report())).mockResolvedValueOnce(
        jsonResponse({
          ranAt: "2026-09-21T10:00:05.000Z",
          rows: [
            {
              id: "reach_connect_host",
              name: "Reach the connect host",
              group: "langwatch",
              cost: "egress",
              verdict: {
                outcome: "verified",
                detail: "connect.langwatch.ai answers on port 443.",
              },
            },
          ],
        }),
      );

      const result = await doctorCommand({ run: true, scenarioRunPlanId: "plan_1" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe("http://localhost:5560/api/checkup/run");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        scenarioRunPlanId: "plan_1",
      });
      const merged = (result?.data as DoctorReport | undefined)?.rows.find(
        (row) => row.id === "reach_connect_host",
      );
      expect(merged?.verdict.outcome).toBe("verified");
    });

    /** @scenario "The usage report prints after the rows" */
    it("prints the exact report as JSON after the rows, naming the host", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(report()));

      const result = await doctorCommand({});
      result?.table();

      const output = logs.join("\n");
      const rowsAt = output.indexOf("Application");
      const reportAt = output.indexOf('"instance_id": "4b1c"');
      expect(rowsAt).toBeGreaterThan(-1);
      expect(reportAt).toBeGreaterThan(rowsAt);
      expect(output).toContain("https://connect.langwatch.ai/v1/stats");
      expect(output).toContain(JSON.stringify(report().usageReport.payload, null, 2));
    });

    /** @scenario "A machine reader gets the whole answer as JSON" */
    it("returns the rows and the report as one document for the JSON format", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(report()));
      setOutputFormat("json");

      const result = await doctorCommand({});

      expect(result?.data).toEqual(report());
    });
  });

  describe("when the install answers 401 to the key", () => {
    /** @scenario "A refused key is reported, not retried" */
    it("fails once and does not retry", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Invalid auth token." }, 401));

      await expect(doctorCommand({})).rejects.toThrow(ProcessExitError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
