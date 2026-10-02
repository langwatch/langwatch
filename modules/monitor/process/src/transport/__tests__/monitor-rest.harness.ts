import {
  bindRestMiddleware,
  createRestRuntime,
  canonicalErrorResponse,
  projectRestFacts,
} from "@langwatch/api/rest";
/**
 * The `/api/monitors` family over the REAL monitor application: memory
 * repositories, recording ports, and the process ports a mount supplies.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { type MonitorApi, type MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import {
  createMonitorTestApp,
  createMonitorTestRepositories,
  FakeMonitorEvaluators,
} from "../../app/__tests__/monitor.fixture.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import { createMonitorsRest } from "../monitor.rest.ts";

/** The project every request in these suites is authenticated for. */
export const TEST_PROJECT = { id: "project-1", slug: "project-one" } as const;

/** The code a refusal names in the canonical envelope. */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body: { code?: string } = await response.json();

  return body.code;
}

/** The family, one application, one repository the test may seed. */
export function mountMonitorRest(
  options: { permits?: boolean; seed?: readonly MonitorWithEvaluator[] } = {},
) {
  const repository = MemoryMonitorRepository.create({ seed: options.seed ?? [] });

  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    evaluators: new FakeMonitorEvaluators(["evaluator-1", "evaluator-2"]),
    permissions: createApiFixture<AuthzApi>({
      hasProjectPermission: async () => options.permits ?? true,
    }),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: TEST_PROJECT.id },
      }),
    },
  });

  const hono = runtime.mount(createMonitorsRest().router(), {
    app: () => app,
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: TEST_PROJECT.slug,
        viewerUserId: "user-1",
        actorId: "user-1",
      })),
    ],
  });

  const send = (method: string, path: string, body?: unknown) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return {
    app: app as MonitorApi,
    repository,
    get: (path: string) => send("GET", path),
    post: (path: string, body?: unknown) => send("POST", path, body ?? {}),
    patch: (path: string, body?: unknown) => send("PATCH", path, body ?? {}),
    delete: (path: string) => send("DELETE", path),
  };
}
