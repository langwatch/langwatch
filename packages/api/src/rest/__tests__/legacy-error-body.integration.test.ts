/**
 * A route publishing main's flat `{ error, message? }` body at a status also sends main's root
 * `error` there, beside the canonical envelope (Alex, 2026-10-06, night; ARCHITECTURE.md §12).
 * Spec: packages/api/specs/transport-conventions.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { defineRestRouter } from "../declaration.ts";
import { documentedResponses, flatErrorStatuses } from "../openapi.ts";
import {
  apiErrorSchema,
  baseResponses,
  canonicalErrorResponse,
  errorSchema,
  legacyErrorOf,
  NotFoundError,
} from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

class ItemNameTakenError extends HandledError {
  constructor() {
    super("item_name_taken", "An item already carries that name", { httpStatus: 422 });
  }
}

class ItemLockedError extends HandledError {
  constructor({ status }: { status: number }) {
    super("item_locked", "The item is locked", { httpStatus: status });
  }
}

class InvalidKeyError extends HandledError {
  constructor() {
    super("invalid_api_key", "The API key is not valid", { httpStatus: 401 });
  }
}

const refusals = {
  handled: () => new ItemNameTakenError(),
  sentence: () => new NotFoundError("Item not found: item_9"),
  unexpected: () => new Error("relation items does not exist on db.internal"),
  conflict: () => new ItemLockedError({ status: 409 }),
  forbidden: () => new ItemLockedError({ status: 403 }),
} as const;

type Refusal = keyof typeof refusals;

const ItemApi = moduleApi<{ update(input: { refusal: Refusal }): Promise<{ ok: boolean }> }>()(
  "annotation",
);

const items = defineRestRouter(ItemApi)
  .withNamespace("annotations")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .put("/items", "updateItem")
  .withInput(z.object({ refusal: z.enum(Object.keys(refusals) as [Refusal, ...Refusal[]]) }))
  .withPermission("annotations:manage")
  .withOutput(z.object({ ok: z.boolean() }))
  .withDocs({
    responses: {
      ...baseResponses,
      ...documentedResponses({ 404: errorSchema, 409: apiErrorSchema }),
    },
  })
  .handle(async ({ app, input }) => app.update(input))
  .build();

function mounted({ refuseDoor = false }: { refuseDoor?: boolean } = {}) {
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: {
      authenticate: () => {
        if (refuseDoor) throw new InvalidKeyError();

        return { actor: null, scope: { tier: "project", id: "project-1" } as const };
      },
    },
  });

  const hono = runtime.mount(items.router(), {
    app: () => ({
      update: async ({ refusal }: { refusal: Refusal }) => {
        throw refusals[refusal]();
      },
    }),
    credential: "project",
    onError: canonicalErrorResponse,
  });

  return async (refusal: Refusal) => {
    const response = await hono.request("/api/v1/annotations/items", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refusal }),
    });

    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
}

describe("a route that publishes main's flat error body", () => {
  /** @scenario "A handled refusal at a status published flat carries its code as the root error" */
  it("sends a handled refusal's code as the root error beside the envelope", async () => {
    const { status, body } = await mounted()("handled");

    expect(status).toBe(422);
    expect(body).toMatchObject({
      error: "item_name_taken",
      type: "unprocessable_entity",
      code: "item_name_taken",
      message: "An item already carries that name",
    });
    expect(errorSchema.validate(body)).toBe(true);
    expect(apiErrorSchema.validate(body)).toBe(true);
  });

  /** @scenario "A sentence refusal at a status published flat carries its sentence as the root error" */
  it("sends a sentence refusal's sentence as the root error beside the envelope", async () => {
    const { status, body } = await mounted()("sentence");

    expect(status).toBe(404);
    expect(body).toMatchObject({
      error: "Item not found: item_9",
      code: "not_found",
      message: "Item not found: item_9",
    });
  });

  /** @scenario "A masked 5xx published flat carries main's internal error sentence" */
  it("sends main's internal sentence for a masked 5xx and keeps the cause out", async () => {
    const { status, body } = await mounted()("unexpected");

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: "Internal server error", code: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });

  /** @scenario "A refusal raised at the door on a route published flat carries the root error" */
  it("adds the root error to the door's 401 as well", async () => {
    const { status, body } = await mounted({ refuseDoor: true })("handled");

    expect(status).toBe(401);
    expect(body).toMatchObject({ error: "invalid_api_key", code: "invalid_api_key" });
  });

  /** @scenario "A refusal at a status not published flat stays the canonical envelope alone" */
  it.each([
    ["conflict", 409],
    ["forbidden", 403],
  ] as const)("sends the %s refusal without a root error", async (refusal, expected) => {
    const { status, body } = await mounted()(refusal);

    expect(status).toBe(expected);
    expect(body).not.toHaveProperty("error");
    expect(body).toMatchObject({ code: "item_locked" });
  });

  /** @scenario "A handled refusal at a status published flat carries its code as the root error" */
  it("reads the flat statuses from the answers the document publishes", async () => {
    const [route] = items.router().routes;

    expect([...(await flatErrorStatuses(route!))].toSorted((a, b) => a - b)).toEqual([
      400, 401, 404, 422, 500,
    ]);
  });
});

describe("main's root error for each kind of failure", () => {
  it("is main's Conflict for a unique violation no service checked", () => {
    const failure = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

    expect(legacyErrorOf({ failure, code: "conflict", status: 409 })).toBe("Conflict");
  });

  it("is the canonical code for a failure the framework maps, such as a schema failure", () => {
    expect(legacyErrorOf({ failure: new Error("x"), code: "validation_error", status: 422 })).toBe(
      "validation_error",
    );
  });
});
