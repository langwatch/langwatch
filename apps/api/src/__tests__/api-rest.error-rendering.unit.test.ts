import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ApiRestObservabilityComposition } from "../app/api-rest-observability.composition";

class ConversationNotOwnedError extends HandledError {
  constructor() {
    super("conversation_not_owned", "This conversation belongs to someone else", {
      httpStatus: 403,
      meta: { conversationId: "conv-1", ownerUserId: "user-2" },
    });
    this.name = "ConversationNotOwnedError";
  }
}

function routeThrowing(error: Error): Hono {
  const app = new Hono();
  app.onError(ApiRestObservabilityComposition.create().legacyErrorHandler);
  app.get("/", () => {
    throw error;
  });
  return app;
}

describe("ApiRestObservabilityComposition.legacyErrorHandler", () => {
  describe("given a service route throws a handled error", () => {
    describe("when the client calls that route", () => {
      /** @scenario "A known failure is normalised by Hono to a client-safe body" */
      it("answers the error's own status with its code, sentence and meta", async () => {
        const response = await routeThrowing(new ConversationNotOwnedError()).request("/");

        expect(response.status).toBe(403);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.error).toBe("conversation_not_owned");
        expect(body.message).toBe("This conversation belongs to someone else");
        expect(body.conversationId).toBe("conv-1");
        expect(body.ownerUserId).toBe("user-2");
      });

      /** @scenario "A known failure is normalised by Hono to a client-safe body" */
      it("carries no stack trace or other internal detail", async () => {
        const response = await routeThrowing(new ConversationNotOwnedError()).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body).not.toHaveProperty("stack");
        expect(body).not.toHaveProperty("name");
        expect(Object.keys(body).sort()).toEqual([
          "conversationId",
          "error",
          "message",
          "ownerUserId",
        ]);
      });

      /** @scenario "An external contract wins over cross-transport symmetry" */
      it("keeps the body flat with a string error field the published SDKs read", async () => {
        const response = await routeThrowing(new ConversationNotOwnedError()).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(typeof body.error).toBe("string");
        expect(body.error).not.toBeTypeOf("object");
      });
    });
  });

  describe("given a route throws an unanticipated failure", () => {
    describe("when the client calls that route", () => {
      it("collapses it to a generic 500 that says nothing about the cause", async () => {
        const response = await routeThrowing(new Error("connection to postgres dropped")).request(
          "/",
        );

        expect(response.status).toBe(500);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.error).toBe("Internal Server Error");
        expect(JSON.stringify(body)).not.toContain("postgres");
      });
    });
  });
});
