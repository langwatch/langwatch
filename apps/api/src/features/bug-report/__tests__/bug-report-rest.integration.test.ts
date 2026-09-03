/**
 * Characterisation of `POST /api/bug-reports` through the real Hono app the
 * API process mounts, over fakes at every port.
 *
 * Three things are pinned, and each of them is a wire the CLI and the MCP
 * report tool already parse: an accepted report answers 201 `{ id }`, a
 * malformed one answers 400 without reaching the intake at all, and the flood
 * refusal answers 429 `{ error, code }` — the handled shape, not a generic
 * envelope. The fourth is the reason this door is public: a request carrying
 * NO credential still files a report, unlinked.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  createBugReportsRestApp,
  SilentBugReportNotifier,
  type BugReportRestPorts,
} from "@langwatch/ops-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

const validReport = {
  source: "cli",
  kind: "summary",
  title: "the run stopped answering",
  summary: "it hung after the third tool call",
};

describe("given the public issue-report intake", () => {
  describe("when a coding agent files a well-formed report", () => {
    it("answers 201 with the stored id and writes it unlinked without a credential", async () => {
      const written: { linkedProjectId: string | null; title: string }[] = [];
      const api = mount({ written });

      const response = await api.fetch("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify(validReport),
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ id: "bugreport_1" });
      expect(written).toEqual([
        { linkedProjectId: null, title: "the run stopped answering" },
      ]);
    });
  });

  describe("when the report carries a project credential", () => {
    it("links it to the project the credential resolves to", async () => {
      const written: { linkedProjectId: string | null; title: string }[] = [];
      const api = mount({
        written,
        credentials: () => ({ token: "lw_key", projectId: null }),
      });

      const response = await api.fetch("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify(validReport),
      });

      expect(response.status).toBe(201);
      expect(written[0]?.linkedProjectId).toBe("project_1");
    });
  });

  describe("when the body is neither JSON nor a report", () => {
    it("answers 400 for each, without reaching the intake", async () => {
      const written: { linkedProjectId: string | null; title: string }[] = [];
      const api = mount({ written });

      const notJson = await api.fetch("/api/bug-reports", {
        method: "POST",
        body: "{",
      });
      expect(notJson.status).toBe(400);
      await expect(notJson.json()).resolves.toEqual({
        error: "Invalid body, expecting JSON",
      });

      const noProse = await api.fetch("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify({ source: "cli", kind: "summary", title: "hello" }),
      });
      expect(noProse.status).toBe(400);
      await expect(noProse.json()).resolves.toMatchObject({ error: "Invalid report" });

      expect(written).toEqual([]);
    });
  });

  describe("when the caller has already filled the window", () => {
    it("answers the handled 429 as `{ error, code }` rather than a generic envelope", async () => {
      const api = mount({ written: [], allowed: false });

      const response = await api.fetch("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify(validReport),
      });

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: "Too many reports, try again later",
        code: "agent_report_rate_limited",
      });
    });
  });

  describe("when the caller is behind a proxy chain", () => {
    it("counts the hop NEAREST us, not the client-supplied first one", async () => {
      const keys: string[] = [];
      const api = mount({ written: [], keys });

      await api.fetch("/api/bug-reports", {
        method: "POST",
        headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9, 10.0.0.1" },
        body: JSON.stringify(validReport),
      });

      expect(keys).toEqual(["bug-report:ip:10.0.0.1"]);
    });
  });
});

function mount(options: {
  written: { linkedProjectId: string | null; title: string }[];
  allowed?: boolean;
  keys?: string[];
  credentials?: BugReportRestPorts["credentials"];
}) {
  let nextId = 0;
  const ports: BugReportRestPorts = {
    reports: () =>
      ({
        create: async ({ data }: { data: { title: string; linkedProjectId?: string | null } }) => {
          nextId += 1;
          options.written.push({
            title: data.title,
            linkedProjectId: data.linkedProjectId ?? null,
          });
          return { id: `bugreport_${nextId}`, ...data };
        },
      }) as never,
    rateLimiter: {
      consume: async ({ key }: { key: string }) => {
        options.keys?.push(key);
        return { allowed: options.allowed ?? true };
      },
    },
    notifier: new SilentBugReportNotifier(),
    credentials: options.credentials ?? (() => null),
    apiKeys: () =>
      ({
        tryResolveToken: async () => ({ project: { id: "project_1" } }),
      }) as never,
  };

  const hono = new Hono().route(
    "/",
    createBugReportsRestApp({ security: passThroughSecurity(), ports }),
  );
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A public endpoint must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
