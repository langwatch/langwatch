/**
 * @vitest-environment node
 * @see modules/suite/specs/suite-templates.feature
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  projectRequestContext,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { SuiteTemplateNotFoundError, type SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { SUITE_TEMPLATES } from "../../features/suite-templates/rules/suite-template-fill.rules.ts";
import { suiteRunOrigin } from "../../rules/suite-wire-v1.rules.ts";
import { createTestSuitesRest } from "../test-suites.rest.ts";

class ForbiddenTestError extends HandledError {
  constructor() {
    super("forbidden", "forbidden", { httpStatus: 403 });
  }
}

const BASE = "http://api.test/api/v1/test-suites/templates";
const fit = { agentName: "Ava", tools: ["refund_order"], mustNever: ["issue refunds over 100"] };

/** A caller holding only these permissions; every permission by default. */
function mount({ grants }: { grants?: readonly string[] } = {}) {
  const listTemplates = vi.fn(async () => [...SUITE_TEMPLATES]);
  const applyTemplate = vi.fn(async ({ templateId }: { templateId: string }) => {
    if (templateId === "no-such-template") throw new SuiteTemplateNotFoundError(templateId);
    return { suiteId: "suite_1", slug: "ava-pack", name: "Ava pack", scenarioIds: ["scen_1"] };
  });
  const app = createApiFixture<SuiteApi>({ listTemplates, applyTemplate });
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: ({ permission }: { permission: string }) => {
        if (grants && !grants.includes(permission)) throw new ForbiddenTestError();
        return {
          actor: { type: "user" as const, id: "user_lena" },
          scope: { tier: "project" as const, id: "project_1" },
        };
      },
    },
  });
  const hono = runtime.mount(createTestSuitesRest().router(), {
    app: () => app,
    credential: "project",
    onError: canonicalErrorResponse,
    middlewareContext: [
      bindMiddlewareContext(projectRequestContext, () => ({
        projectSlug: "acme",
        viewerUserId: "user_lena",
        actorId: "user_lena",
      })),
      bindMiddlewareContext(suiteRunOrigin, (request) => ({
        surface: request.headers.get("x-langwatch-surface") ?? null,
        callerKey: null,
      })),
    ],
  });
  const send = (method: string, url: string, body?: unknown) =>
    hono.fetch(
      new Request(url, {
        method,
        headers: { "content-type": "application/json", "x-langwatch-surface": "cli" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { send, listTemplates, applyTemplate };
}

describe("GET /api/v1/test-suites/templates", () => {
  /** @scenario "Listing templates over REST answers every shipped template" */
  it("answers every shipped template with its scenarios", async () => {
    const { send } = mount();
    const response = await send("GET", BASE);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; scenarios: unknown[] }[];
    expect(body.map((template) => template.id)).toEqual(SUITE_TEMPLATES.map(({ id }) => id));
    expect(body.every((template) => template.scenarios.length > 0)).toBe(true);
  });
});

describe("POST /api/v1/test-suites/templates/:templateId/apply", () => {
  /** @scenario "Applying a template over REST creates a test suite" */
  it("answers 201 with the new suite and passes the project, fit and caller on", async () => {
    const { send, applyTemplate } = mount();
    const response = await send("POST", `${BASE}/owasp-agentic-top-10/apply`, {
      fit,
      name: "Ava pack",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      suiteId: "suite_1",
      slug: "ava-pack",
      name: "Ava pack",
      scenarioIds: ["scen_1"],
    });
    expect(applyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        templateId: "owasp-agentic-top-10",
        name: "Ava pack",
        fit: expect.objectContaining({ agentName: "Ava" }),
      }),
      { id: "user_lena", label: "cli" },
      { userId: "user_lena", label: "cli" },
    );
  });

  /** @scenario "Applying an unknown template over REST answers 404" */
  it("answers 404 suite_template_not_found", async () => {
    const { send } = mount();
    const response = await send("POST", `${BASE}/no-such-template/apply`, { fit });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "suite_template_not_found" });
  });

  describe("when the caller may only view scenarios", () => {
    /** @scenario "A caller without scenario manage permission cannot apply a template" */
    it("refuses with 403 before the handler runs", async () => {
      const { send, applyTemplate } = mount({ grants: ["scenarios:view"] });
      const response = await send("POST", `${BASE}/owasp-llm-top-10-2025/apply`, { fit });
      expect(response.status).toBe(403);
      expect(applyTemplate).not.toHaveBeenCalled();
    });

    it("still lists the templates", async () => {
      const { send } = mount({ grants: ["scenarios:view"] });
      const response = await send("GET", BASE);
      expect(response.status).toBe(200);
    });
  });
});
