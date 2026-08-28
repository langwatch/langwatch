import { TeamNotFoundError } from "@langwatch/organization-contract";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextBindingsFor, appContextMiddleware } from "../app-context";
import { organizationMiddleware } from "../organization";

const organizations = {
  getTeamById: vi.fn(),
};

const app = Object.create(Object.prototype);
app.organizations = organizations;

function requestWithProject(project?: { teamId: string }) {
  const api = new Hono();
  api.use(appContextMiddleware);
  api.use(async (c, next) => {
    if (project) c.set("project", project);
    await next();
  });
  api.use(organizationMiddleware);
  api.get("/", (c) => c.json(c.get("organization")));
  return api.request("/", void 0, appContextBindingsFor(app));
}

describe("organizationMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gets the project team from the composed organization service", async () => {
    organizations.getTeamById.mockResolvedValue({ organizationId: "org-1" });

    const response = await requestWithProject({ teamId: "team-1" });

    expect(organizations.getTeamById).toHaveBeenCalledWith({ teamId: "team-1" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "org-1" });
  });

  it("preserves the missing-team response", async () => {
    organizations.getTeamById.mockRejectedValue(new TeamNotFoundError("team-1"));

    const response = await requestWithProject({ teamId: "team-1" });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal Server Error",
      message: "Organization not found",
    });
  });

  it("preserves the response when the project middleware did not run", async () => {
    const response = await requestWithProject();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal Server Error",
      message: "Trying to use organization middleware without project",
    });
  });
});
