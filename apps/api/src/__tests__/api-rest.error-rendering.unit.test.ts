import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { ApiRestObservabilityComposition } from "../app/api-rest-observability.composition.ts";

class DatasetQuotaReachedError extends HandledError {
  constructor() {
    super("dataset_quota_reached", "This project has reached its dataset limit", {
      httpStatus: 402,
      tips: ["Archive a dataset you no longer need", "Upgrade the project's plan"],
      docsUrl: "https://docs.langwatch.ai/datasets/limits",
    });
    this.name = "DatasetQuotaReachedError";
  }
}

class DatasetStorageUnavailableError extends HandledError {
  constructor(cause: Error) {
    super("dataset_storage_unavailable", "Dataset storage is temporarily unavailable", {
      httpStatus: 503,
      fault: "platform",
      reasons: [cause],
    });
    this.name = "DatasetStorageUnavailableError";
  }
}

class DatasetSchemaRejectedError extends HandledError {
  constructor(reasons: readonly Error[]) {
    super("dataset_schema_rejected", "Some of the values aren't valid", {
      httpStatus: 422,
      reasons,
    });
    this.name = "DatasetSchemaRejectedError";
  }
}

class RejectedFieldError extends HandledError {
  constructor(field: string) {
    super("validation_error", `The ${field} field is not valid`, {
      httpStatus: 422,
      meta: { field },
    });
    this.name = "RejectedFieldError";
  }
}

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

function canonicalRouteThrowing(error: Error): Hono {
  const app = new Hono();
  app.onError(ApiRestObservabilityComposition.create().canonicalErrorHandler);
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
          "fault",
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

  describe("given a route raises a handled refusal carrying remediation copy", () => {
    describe("when the client calls that route", () => {
      /** @scenario "A handled refusal ships its tips and documentation link" */
      it("ships the tips a caller with no presentation registry follows", async () => {
        const response = await routeThrowing(new DatasetQuotaReachedError()).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.tips).toEqual([
          "Archive a dataset you no longer need",
          "Upgrade the project's plan",
        ]);
      });

      /** @scenario "A handled refusal ships its tips and documentation link" */
      it("ships the documentation link", async () => {
        const response = await routeThrowing(new DatasetQuotaReachedError()).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.docsUrl).toBe("https://docs.langwatch.ai/datasets/limits");
      });

      /** @scenario "A handled refusal says who can act on it" */
      it("says the refusal is the customer's to act on", async () => {
        const response = await routeThrowing(new DatasetQuotaReachedError()).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.fault).toBe("customer");
      });
    });
  });

  describe("given a route raises a refusal attributed to the platform", () => {
    describe("when the client calls that route", () => {
      /** @scenario "A handled refusal says who can act on it" */
      it("says the fault is the platform's, not the caller's", async () => {
        const response = await routeThrowing(
          new DatasetStorageUnavailableError(new Error("connection to postgres dropped")),
        ).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.fault).toBe("platform");
      });
    });
  });

  describe("given a route raises a refusal made of one reason per rejected field", () => {
    describe("when the client calls that route", () => {
      /** @scenario "A refusal made of several facts ships all of them" */
      it("ships a reason for each rejected field rather than one bare sentence", async () => {
        const response = await routeThrowing(
          new DatasetSchemaRejectedError([
            new RejectedFieldError("name"),
            new RejectedFieldError("columnTypes"),
          ]),
        ).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        const reasons = body.reasons as Array<Record<string, unknown>>;
        expect(reasons).toHaveLength(2);
        expect(reasons.map((reason) => reason.code)).toEqual([
          "validation_error",
          "validation_error",
        ]);
        expect(reasons.map((reason) => (reason.meta as { field: string }).field)).toEqual([
          "name",
          "columnTypes",
        ]);
      });
    });
  });

  describe("given a handled refusal whose cause nobody anticipated", () => {
    describe("when the client calls that route", () => {
      /** @scenario "An unanticipated cause behind a handled refusal stays masked" */
      it("reports the cause as unknown and names none of its detail", async () => {
        const response = await routeThrowing(
          new DatasetStorageUnavailableError(new Error("connection to postgres dropped")),
        ).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        const reasons = body.reasons as Array<Record<string, unknown>>;
        expect(reasons.map((reason) => reason.code)).toEqual(["unknown"]);
        expect(JSON.stringify(body)).not.toContain("postgres");
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

/**
 * The same refusal raised through a SECOND copy of the framework's module.
 *
 * The booted process resolves `hono/http-exception` more than once — the ESM
 * and CommonJS builds of one version, and whatever the instrumentation loader
 * wraps — so the class a feature package throws is not always the class the
 * boundary imported. Rendering by `instanceof` answered every such refusal as
 * a 500; this stands in for the second copy so the boundary is pinned on the
 * shape rather than the identity.
 */
class ForeignFrameworkRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }

  getResponse(): Response {
    return new Response(this.message, { status: this.status });
  }
}

describe("given a route raises the HTTP framework's own refusal", () => {
  describe("when the client calls that route", () => {
    /** @scenario "A framework refusal keeps the status it was raised with" */
    it("answers the refusal's own status on the legacy body, not 500", async () => {
      const response = await routeThrowing(
        new HTTPException(404, { message: "Config not found" }),
      ).request("/");

      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toBe("Config not found");
    });

    /** @scenario "A framework refusal keeps the status it was raised with" */
    it("answers the refusal's own status on the canonical envelope, not 500", async () => {
      const response = await canonicalRouteThrowing(
        new HTTPException(404, { message: "Config not found" }),
      ).request("/");

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: Record<string, unknown> };
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe("Config not found");
    });

    /** @scenario "A framework refusal raised through a second copy of the framework is still a refusal" */
    it("answers a foreign copy's refusal at its own status on the legacy body", async () => {
      const response = await routeThrowing(
        new ForeignFrameworkRefusal(404, "Evaluator not found"),
      ).request("/");

      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toBe("Evaluator not found");
    });

    /** @scenario "A framework refusal raised through a second copy of the framework is still a refusal" */
    it("answers a foreign copy's refusal at its own status on the canonical envelope", async () => {
      const response = await canonicalRouteThrowing(
        new ForeignFrameworkRefusal(404, "Evaluator not found"),
      ).request("/");

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: Record<string, unknown> };
      expect(body.error.code).toBe("not_found");
      expect(body.error.message).toBe("Evaluator not found");
    });

    /** @scenario "A framework refusal at 5xx still collapses to the generic body" */
    it("keeps a 5xx refusal's status but says nothing about its cause", async () => {
      const response = await routeThrowing(
        new HTTPException(503, { message: "postgres pool exhausted" }),
      ).request("/");

      expect(response.status).toBe(503);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.message).toBe("An unknown error occurred");
      expect(JSON.stringify(body)).not.toContain("postgres");
    });
  });
});
