/**
 * A family's own error boundary renders the door's refusal: a family that declares the canonical
 * envelope answers it, one that declares none keeps its flat body. Spec:
 * specs/security/api-endpoint-authorization.feature.
 */

import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import { createErrorHandler, ProjectMissingCredentialsError } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

interface NoteApi {
  list(): Promise<{ id: string }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");

const notes = defineRestRouter(NoteApi)
  .withNamespace("notes")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .withCredential("organization")

  .get("/", "listNotes")
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app }) => app.list())
  .build();

function mounted(onError: Parameters<ReturnType<typeof createRestRuntime>["mount"]>[1]["onError"]) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new ProjectMissingCredentialsError();
      },
      identify: () => {
        throw new ProjectMissingCredentialsError();
      },
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });

  return runtime.mount(notes.router(), {
    app: () => createApiDouble<NoteApi>({ list: async () => ({ id: "n1" }) }),
    onError,
  });
}

describe("a family's refusal of a request with no credential", () => {
  /** @scenario A legacy family keeps the flat error body its consumers parse */
  it("is rendered by the family's own flat boundary when it declares no envelope", async () => {
    const hono = mounted((_error, context) =>
      context.json({ error: "Unauthorized", message: "Authentication required" }, 401),
    );

    const response = await hono.request("/api/v1/notes");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Unauthorized",
      message: "Authentication required",
    });
  });

  it("is rendered as the canonical envelope when the family declares it", async () => {
    const response = await mounted(createErrorHandler()).request("/api/v1/notes");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "missing_credentials" });
  });
});
