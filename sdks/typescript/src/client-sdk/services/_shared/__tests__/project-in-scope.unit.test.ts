/**
 * A project key carries its own project, so the services whose route names a project ask the
 * platform which one instead of refusing for want of `--project`.
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const langwatchFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/internal/http/langwatchFetch", () => ({
  langwatchFetch: langwatchFetchMock,
}));

import { ChartsApiService } from "@/client-sdk/services/charts/charts-api.service";
import { DashboardWidgetsApiService } from "@/client-sdk/services/dashboard-widgets/dashboard-widgets-api.service";
import { SecretsApiService } from "@/client-sdk/services/secrets/secrets-api.service";
import type { LangwatchApiClient } from "@/internal/api/client";

const OWN_PROJECT = "project_own";

const answerKeyProject = () => {
  langwatchFetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/v1/me/project")) {
      return Response.json({ id: OWN_PROJECT, name: "Own", slug: "own", isPersonal: false });
    }
    return Response.json([]);
  });
};

const recordingClient = () => {
  const GET = vi.fn(async () => ({ data: { data: [] }, response: new Response(null) }));
  return { client: { GET } as unknown as LangwatchApiClient, GET };
};

const pathProjectOf = (GET: ReturnType<typeof vi.fn>): unknown => {
  const options = GET.mock.calls[0]?.[1] as { params: { path: { projectId: string } } } | undefined;
  return options?.params.path.projectId;
};

let keyCounter = 0;

beforeEach(() => {
  keyCounter += 1;
  vi.stubEnv("LANGWATCH_API_KEY", `sk-lw-legacyprojectkey${keyCounter}`);
  vi.stubEnv("LANGWATCH_ENDPOINT", "http://localhost:5590");
  vi.stubEnv("LANGWATCH_PROJECT_ID", "");
  answerKeyProject();
});

afterEach(() => {
  vi.unstubAllEnvs();
  langwatchFetchMock.mockReset();
});

describe("given LANGWATCH_API_KEY is a project key", () => {
  describe("when no --project or LANGWATCH_PROJECT_ID names one", () => {
    /** @scenario "a project key reaches the commands whose route names a project" */
    it("runs chart, dashboard widget and secret calls against the key's own project", async () => {
      const charts = recordingClient();
      await new ChartsApiService({ langwatchApiClient: charts.client }).list();
      expect(pathProjectOf(charts.GET)).toBe(OWN_PROJECT);

      const widgets = recordingClient();
      await new DashboardWidgetsApiService({ langwatchApiClient: widgets.client }).list();
      expect(pathProjectOf(widgets.GET)).toBe(OWN_PROJECT);

      await new SecretsApiService().getAll();
      const secretsUrl = langwatchFetchMock.mock.calls
        .map(([url]) => url as string)
        .find((url) => url.includes("/api/v1/secrets"));
      expect(secretsUrl).toContain(`projectId=${OWN_PROJECT}`);
    });

    it("asks the platform for the key's project once per key", async () => {
      const charts = recordingClient();
      const service = new ChartsApiService({ langwatchApiClient: charts.client });
      await service.list();
      await service.list();
      const lookups = langwatchFetchMock.mock.calls.filter(([url]) =>
        (url as string).endsWith("/api/v1/me/project"),
      );
      expect(lookups).toHaveLength(1);
    });
  });

  describe("when LANGWATCH_PROJECT_ID names another project", () => {
    /** @scenario "a stale LANGWATCH_PROJECT_ID beside a project key never reaches the route" */
    it("names the key's own project in the route, as the warning says", async () => {
      vi.stubEnv("LANGWATCH_PROJECT_ID", "project_stale");
      const charts = recordingClient();
      await new ChartsApiService({ langwatchApiClient: charts.client }).list();
      expect(pathProjectOf(charts.GET)).toBe(OWN_PROJECT);
    });
  });
});

describe("given LANGWATCH_API_KEY is a user-scoped key", () => {
  it("reads LANGWATCH_PROJECT_ID and never asks the platform for a key project", async () => {
    vi.stubEnv("LANGWATCH_API_KEY", `sk-lw-user_scoped${keyCounter}`);
    vi.stubEnv("LANGWATCH_PROJECT_ID", "project_env");
    const charts = recordingClient();
    await new ChartsApiService({ langwatchApiClient: charts.client }).list();
    expect(pathProjectOf(charts.GET)).toBe("project_env");
    expect(langwatchFetchMock).not.toHaveBeenCalled();
  });
});

describe("given the key project lookup fails", () => {
  describe("when the platform answers with an error status", () => {
    it("warns with the status before falling back", async () => {
      langwatchFetchMock.mockImplementation(async () => new Response(null, { status: 401 }));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const charts = recordingClient();

      await expect(
        new ChartsApiService({ langwatchApiClient: charts.client }).list(),
      ).rejects.toThrow(/No project is in scope/);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("/api/v1/me/project (HTTP 401)"));
      warn.mockRestore();
    });
  });

  describe("when the request itself throws", () => {
    it("warns with the error before falling back", async () => {
      langwatchFetchMock.mockImplementation(async () => {
        throw new Error("connect ECONNREFUSED");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const widgets = recordingClient();

      await expect(
        new DashboardWidgetsApiService({ langwatchApiClient: widgets.client }).list(),
      ).rejects.toThrow(/No project is in scope/);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining("connect ECONNREFUSED"));
      warn.mockRestore();
    });
  });
});

describe("given a secret is created", () => {
  it("names one project in the body and the credentials", async () => {
    vi.stubEnv("LANGWATCH_API_KEY", `sk-lw-user_scoped${keyCounter}`);
    vi.stubEnv("LANGWATCH_PROJECT_ID", "project_env");
    langwatchFetchMock.mockImplementation(async () => Response.json({ id: "secret_1" }));

    await new SecretsApiService().create({ name: "TOKEN", value: "v" });

    const [, init] = langwatchFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ projectId: "project_env" });
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    const decoded = Buffer.from(authorization.replace(/^Basic /, ""), "base64").toString();
    expect(decoded.startsWith("project_env:")).toBe(true);
  });
});
