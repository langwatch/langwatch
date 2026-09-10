/**
 * The `/api/monitors` family over the REAL monitor application: memory
 * repositories, recording ports, and the process ports a mount supplies.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { MonitorApi, type MonitorWithEvaluator } from "@langwatch/monitor-contract";
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

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.langwatch.test/${projectSlug}${path}`;

/** A handled refusal at its own status, carrying its own code. */
const renderHandled: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json({ ...error.serialize(), message: error.message }, error.httpStatus as 400);
  }

  return c.json({ code: "internal_error", message: String(error) }, 500);
};

/** The code a refusal names, whichever body shape the family published. */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string; error?: string | { code?: string } };
  if (typeof body.code === "string") return body.code;
  if (typeof body.error === "string") return body.error;

  return body.error?.code;
}

/** The family, one application, one repository the test may seed. */
export function mountMonitorRest(
  options: { permits?: boolean; seed?: readonly MonitorWithEvaluator[] } = {},
) {
  const repository = MemoryMonitorRepository.create();
  for (const monitor of options.seed ?? []) repository.seed(monitor);

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

  const hono = runtime.mount(createMonitorsRest(platformUrl).router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
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
