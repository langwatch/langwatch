/**
 * A database failure while the door authenticates is not a refusal: the caller gets the family's
 * server error, the route never runs, and a family that owns its answer receives the failure as it
 * arrived. Spec: specs/errors/handled-error-surfaces.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import type { ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { RestIdentity } from "../../hosting/api-door.ts";
import { defineRestRouter } from "../declaration.ts";
import { createCanonicalFamilyErrorHandler } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

const Api = moduleApi<{ read(): { ok: boolean } }>()("organization");

const organizationRoutes = defineRestRouter(Api)
  .withNamespace("organizations")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .withCredential("organization")
  .get("/", "listOrganizations")
  .withPermission("organization:view")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

const DATABASE_FAILURE = "Can't reach database server at `db.internal:5432`";

function mounted({ onError, reached }: { onError: ErrorHandler; reached: string[] }) {
  const door: RestIdentity = {
    authenticate: () => {
      throw new Error(DATABASE_FAILURE);
    },
    identify: () => {
      throw new Error(DATABASE_FAILURE);
    },
    authorize: () => ({ permitted: true, organizationRole: null }),
  };
  const runtime = createRestRuntime({ identity: door, doors: { organization: door } });

  return runtime.mount(organizationRoutes.router(), {
    app: () => ({
      read: () => {
        reached.push("read");

        return { ok: true };
      },
    }),
    onError,
  });
}

describe("an organization-scoped credential whose organization fails to load on the database", () => {
  /** @scenario "A database failure loading the organization answers the family's server error" */
  it("answers the family's internal error and never reaches the route", async () => {
    const reached: string[] = [];
    const hono = mounted({
      reached,
      onError: createCanonicalFamilyErrorHandler({
        loggerName: "langwatch:api:test:errors",
        label: "Test API Error",
      }),
    });

    const response = await hono.request("/api/v1/organizations");
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ code: "internal_error" });
    expect(text).not.toContain("db.internal");
    expect(reached).toEqual([]);
  });

  /** @scenario "A database failure loading the organization is re-raised unchanged" */
  it("hands a family that owns its answer the original failure, not a handled one", async () => {
    const received: unknown[] = [];
    const hono = mounted({
      reached: [],
      onError: (error, context) => {
        received.push(error);

        return context.json({ error: "Internal server error" }, 500);
      },
    });

    const response = await hono.request("/api/v1/organizations");

    expect(response.status).toBe(500);
    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(Error);
    expect((received[0] as Error).message).toBe(DATABASE_FAILURE);
    expect(HandledError.isHandled(received[0])).toBe(false);
  });
});
