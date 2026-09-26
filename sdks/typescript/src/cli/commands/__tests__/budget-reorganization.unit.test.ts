/**
 * The CLI steps of moving an organization from one gateway budget to one per
 * team: moving projects between teams, copying team members in bulk, and
 * creating a team budget.
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */
import { stripVTControlCharacters } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

/** The success and failure lines the spinner was asked to print, newest last. */
const spinnerLines = vi.hoisted(() => ({ succeeded: [] as string[], failed: [] as string[] }));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn((text?: string) => {
      if (text !== undefined) spinnerLines.succeeded.push(text);
    }),
    fail: vi.fn((text?: string) => {
      if (text !== undefined) spinnerLines.failed.push(text);
    }),
    stop: vi.fn(),
  }),
}));

import { createGatewayBudgetCommand } from "../gateway-budgets/create";
import { moveProjectCommand } from "../projects/move";
import { createTeamCommand } from "../teams/create";
import { addTeamMembersCommand } from "../teams/members";

class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

type Route = (request: { method: string; url: URL; body: unknown }) => unknown;

let routes: { method: string; path: RegExp; answer: Route; status?: number }[];
let requests: { method: string; url: URL; body: unknown }[];
let logged: string[];

/** Answers the request whose method and path match, in the order routes were added. */
const respond = (method: string, path: RegExp, answer: Route, status = 200): void => {
  routes.push({ method, path, answer, status });
};

const stripColour = (text: string): string => stripVTControlCharacters(text);

const PROJECTS_PAGE = {
  data: [
    {
      id: "project_checkout",
      name: "Checkout",
      slug: "checkout",
      language: "python",
      framework: "openai",
      teamId: "team_platform",
      piiRedactionLevel: "ESSENTIAL",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
};

const TEAMS_PAGE = {
  data: [
    { id: "team_platform", name: "Platform", slug: "platform", organizationId: "org_1" },
    { id: "team_payments", name: "Payments", slug: "payments", organizationId: "org_1" },
  ],
  pagination: { page: 1, limit: 100, total: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  spinnerLines.succeeded.length = 0;
  spinnerLines.failed.length = 0;
  process.env.LANGWATCH_API_KEY = "test-key";
  routes = [];
  requests = [];
  logged = [];
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ method, url, body });
    const route = routes.find((r) => r.method === method && r.path.test(url.pathname));
    if (!route) throw new Error(`no route for ${method} ${url.pathname}`);
    const status = route.status ?? 200;
    return new Response(JSON.stringify(route.answer({ method, url, body })), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(stripColour(args.map(String).join(" ")));
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

describe("projects move", () => {
  beforeEach(() => {
    respond("GET", /^\/api\/projects$/, () => PROJECTS_PAGE);
    respond("GET", /^\/api\/v1\/teams$/, () => TEAMS_PAGE);
    respond("PATCH", /^\/api\/projects\/project_checkout$/, ({ body }) => ({
      ...PROJECTS_PAGE.data[0],
      ...(body as object),
    }));
  });

  describe("when the project and the team are named by slug and name", () => {
    /** @scenario The CLI moves a project to another team */
    it("sends the project update with the destination team's id", async () => {
      const result = await moveProjectCommand({ project: "checkout", team: "Payments" });

      const update = requests.find((request) => request.method === "PATCH");
      expect(update?.url.pathname).toBe("/api/projects/project_checkout");
      expect(update?.body).toEqual({ teamId: "team_payments" });
      expect(stripColour(spinnerLines.succeeded.at(-1) ?? "")).toBe(
        'Moved project "Checkout" to team "Payments"',
      );
      expect(result).toMatchObject({ data: { id: "project_checkout", teamId: "team_payments" } });
    });
  });

  describe("when the team matches nothing", () => {
    /** @scenario The CLI refuses a move to a team that does not exist */
    it("fails naming the team and sends no update", async () => {
      await expect(moveProjectCommand({ project: "checkout", team: "Nowhere" })).rejects.toThrow(
        ProcessExitError,
      );

      expect(requests.some((request) => request.method === "PATCH")).toBe(false);
      expect(stripColour(spinnerLines.failed.at(-1) ?? "")).toContain('"Nowhere"');
    });
  });
});

describe("teams members add", () => {
  describe("when several users are added in one command", () => {
    /** @scenario Several users are added to a team in one command */
    it("adds each one with the given role", async () => {
      respond("POST", /^\/api\/v1\/teams\/team_payments\/members$/, () => ({ success: true }), 201);

      const result = await addTeamMembersCommand({
        teamId: "team_payments",
        userIds: ["user_a", "user_b", "user_c"],
        options: { role: "viewer" },
      });

      expect(requests.map((request) => request.body)).toEqual([
        { userId: "user_a", role: "VIEWER" },
        { userId: "user_b", role: "VIEWER" },
        { userId: "user_c", role: "VIEWER" },
      ]);
      expect(result).toMatchObject({
        data: {
          added: [
            { userId: "user_a", role: "VIEWER" },
            { userId: "user_b", role: "VIEWER" },
            { userId: "user_c", role: "VIEWER" },
          ],
          failed: [],
        },
      });
    });
  });

  describe("when one of the users cannot be added", () => {
    /** @scenario A bulk add reports the users it could not add */
    it("still adds the others and fails naming the one left out", async () => {
      routes.push({
        method: "POST",
        path: /^\/api\/v1\/teams\/team_payments\/members$/,
        answer: ({ body }) =>
          (body as { userId: string }).userId === "user_b"
            ? { code: "user_not_in_organization", message: "User is not in this organization" }
            : { success: true },
      });
      global.fetch = wrapStatus(global.fetch, (body) =>
        (body as { userId?: string } | undefined)?.userId === "user_b" ? 404 : 201,
      );

      await expect(
        addTeamMembersCommand({ teamId: "team_payments", userIds: ["user_a", "user_b", "user_c"] }),
      ).rejects.toThrow(ProcessExitError);

      expect(requests.map((request) => (request.body as { userId: string }).userId)).toEqual([
        "user_a",
        "user_b",
        "user_c",
      ]);
      const failure = stripColour(spinnerLines.failed.at(-1) ?? "");
      expect(failure).toContain("user_b");
      expect(failure).toContain("2 users were added");
    });
  });
});

describe("teams create --copy-members-from", () => {
  /** @scenario A new team copies the members of an existing team */
  it("creates the team and adds each member with the role they hold on the source", async () => {
    respond("GET", /^\/api\/v1\/teams\/team_platform\/members$/, () => ({
      data: [
        { userId: "user_admin", name: "Ada", email: "ada@acme.test", role: "ADMIN" },
        { userId: "user_member", name: "Bo", email: "bo@acme.test", role: "MEMBER" },
        { userId: "user_member", name: "Bo", email: "bo@acme.test", role: "VIEWER" },
        { userId: "user_viewer", name: "Cy", email: "cy@acme.test", role: "VIEWER" },
        { userId: "user_custom", name: "Di", email: "di@acme.test", role: "CUSTOM" },
      ],
    }));
    respond(
      "POST",
      /^\/api\/v1\/teams$/,
      () => ({ id: "team_payments", name: "Payments", slug: "payments", organizationId: "org_1" }),
      201,
    );
    respond("POST", /^\/api\/v1\/teams\/team_payments\/members$/, () => ({ success: true }), 201);

    const result = await createTeamCommand({ name: "Payments", copyMembersFrom: "team_platform" });

    const adds = requests.filter((request) => request.url.pathname.endsWith("/members"));
    expect(adds.filter((request) => request.method === "POST").map((r) => r.body)).toEqual([
      { userId: "user_admin", role: "ADMIN" },
      { userId: "user_member", role: "MEMBER" },
      { userId: "user_viewer", role: "VIEWER" },
    ]);
    expect(result).toMatchObject({
      data: {
        id: "team_payments",
        copiedMembers: {
          skipped: [{ userId: "user_custom", reason: expect.stringContaining("custom role") }],
        },
      },
    });
    expect(stripColour(spinnerLines.succeeded.at(-1) ?? "")).toBe(
      'Created team "Payments" with 3 members copied from team "team_platform"',
    );
  });
});

describe("gateway-budgets create", () => {
  /** @scenario The CLI notes that spend before creation is not counted */
  it("says spend earlier in the current window is not counted", async () => {
    respond(
      "POST",
      /^\/api\/gateway\/v1\/budgets$/,
      () => ({
        budget: {
          id: "bdg_1",
          organization_id: "org_1",
          scope_type: "team",
          scope_id: "team_payments",
          name: "Payments monthly",
          description: null,
          window: "month",
          on_breach: "block",
          limit_usd: "150",
          spent_usd: "0",
          timezone: null,
          provider_key: null,
          current_period_started_at: "2026-09-26T00:00:00.000Z",
          resets_at: "2026-10-01T00:00:00.000Z",
          last_reset_at: null,
          archived_at: null,
          created_at: "2026-09-26T00:00:00.000Z",
        },
      }),
      201,
    );

    const result = await createGatewayBudgetCommand({
      name: "Payments monthly",
      scope: "team",
      team: "team_payments",
      window: "month",
      limit: "150",
    });
    (result as { table: () => void }).table();

    expect(logged.join("\n")).toContain(
      "This budget counts spend from now on. Spend earlier in the current window is not counted.",
    );
  });
});

/** Answers with a status that depends on the request body, keeping the JSON the route wrote. */
function wrapStatus(inner: typeof fetch, statusFor: (body: unknown) => number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await inner(input, init);
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(await response.text(), {
      status: statusFor(body),
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}
