/**
 * @vitest-environment node
 * `/api/health/*` pinned to main's statuses and bodies, over the real probes.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { MemorySubsystemProbeChannel } from "../../channels/memory/memory.subsystem-probe.channel.ts";
import { ProjectKeyedProbeService } from "../../services/project-keyed-probe.service.ts";
import { SubsystemProbeService } from "../../services/subsystem-probe.service.ts";
import { platformHealthProbeRest } from "../platform-health-probe.rest.ts";

const KEY = "sk-lw-known";

function probe() {
  const canaries = MemorySubsystemProbeChannel.create({
    answer: () => new Response(JSON.stringify({ passed: true }), { status: 200 }),
  });
  const probes = SubsystemProbeService.create({
    collaborators: {
      canaries,
      automation: () => ({ findById: async () => null, getRecentFires: async () => [] }),
      workflowExists: async () => false,
    },
  });
  const service = ProjectKeyedProbeService.create({
    probes,
    resolveProject: async ({ token }) => (token === KEY ? "project-1" : null),
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The probes resolve their own key.");
      },
      identify: () => ({ actor: null, scope: null }),
    },
  });
  const hono = runtime.mount(platformHealthProbeRest.router(), {
    app: () => ({ probeWithProjectKey: (request) => service.probe(request) }),
    onError: canonicalErrorResponse,
  });

  return {
    canaries,
    get: (path: string, headers: Record<string, string> = {}) =>
      hono.fetch(new Request(`http://api.test/api/health${path}`, { headers })),
  };
}

describe("GET /api/health/*", () => {
  /** @scenario "A project-keyed probe with no token is refused with main's sentence" */
  it("answers 401 with main's sentence when no token is presented", async () => {
    const response = await probe().get("/collector");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  });

  /** @scenario "A project-keyed probe with an unknown key is refused" */
  it("answers 401 Invalid auth token for a key that resolves to nothing", async () => {
    const response = await probe().get("/evaluations", { "X-Auth-Token": "nope" });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Invalid auth token." });
  });

  /** @scenario "A project-keyed probe accepts an API key as a Bearer token and forwards it" */
  it("runs the sample evaluation as the caller's key and answers the canary's status and body", async () => {
    const { get, canaries } = probe();

    const response = await get("/evaluations", { Authorization: `Bearer ${KEY}` });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, body: { passed: true } });
    expect(canaries.requests()[0]?.headers).toMatchObject({
      "X-Auth-Token": KEY,
      "X-Project-Id": "project-1",
    });
  });

  /** @scenario "A project-keyed probe reports a missing trigger as main did" */
  it("answers 404 Trigger not found for a trigger the project lacks", async () => {
    const response = await probe().get("/triggers?triggerId=t-1", { "X-Auth-Token": KEY });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Trigger not found." });
  });
});
