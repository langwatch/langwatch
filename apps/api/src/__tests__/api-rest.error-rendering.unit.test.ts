import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
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

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";

/**
 * A refusal and its reason both raised inside one traced request, so both
 * carry the same pair. The response must still show it once.
 */
class TracedRefusal extends HandledError {
  constructor(reasons: readonly Error[]) {
    super("dataset_schema_rejected", "Some of the values aren't valid", {
      httpStatus: 422,
      reasons,
      traceId: TRACE_ID,
      spanId: SPAN_ID,
    });
    this.name = "TracedRefusal";
  }
}

class TracedRejectedFieldError extends HandledError {
  constructor(field: string) {
    super("validation_error", `The ${field} field is not valid`, {
      httpStatus: 422,
      meta: { field },
      traceId: TRACE_ID,
      spanId: SPAN_ID,
    });
    this.name = "TracedRejectedFieldError";
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

  describe("given a caller names an API key id that does not exist", () => {
    describe("when the refusal is rendered as the flat legacy body", () => {
      /** @scenario "A missing API key names the two ways to find the right id" */
      it("ships the tips for checking and listing the key ids", async () => {
        const response = await routeThrowing(new ApiKeyNotFoundError("key-404")).request("/");

        expect(response.status).toBe(404);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.tips).toEqual([
          "Check the API key id; the key may have been deleted or never created",
          "List the keys on the organization to find the right id",
        ]);
      });

      /** @scenario "A missing API key names the two ways to find the right id" */
      it("ships the documentation link for API keys", async () => {
        const response = await routeThrowing(new ApiKeyNotFoundError("key-404")).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(body.docsUrl).toBe("https://docs.langwatch.ai/api-reference/api-keys/overview");
      });

      /** @scenario "A missing API key names the two ways to find the right id" */
      it("ships exactly the keys the published clients read", async () => {
        const response = await routeThrowing(new ApiKeyNotFoundError("key-404")).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual([
          "apiKeyId",
          "docsUrl",
          "error",
          "fault",
          "id",
          "message",
          "tips",
        ]);
      });
    });
  });

  describe("given a route raises a refusal made of one reason per rejected field", () => {
    describe("when the refusal is rendered as the flat legacy body", () => {
      /** @scenario "A refusal made of several facts ships all of them" */
      it("ships exactly the keys the published clients read", async () => {
        const response = await routeThrowing(
          new DatasetSchemaRejectedError([new RejectedFieldError("name")]),
        ).request("/");

        const body = (await response.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(["error", "fault", "message", "reasons"]);
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

describe("ApiRestObservabilityComposition.canonicalErrorHandler", () => {
  describe("given a route raises a handled refusal carrying remediation copy", () => {
    describe("when the refusal is rendered", () => {
      /** @scenario "A handled refusal ships its remediation channel in the envelope" */
      it("ships the tips a caller with no presentation registry follows", async () => {
        const response = await canonicalRouteThrowing(new DatasetQuotaReachedError()).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        expect(body.error.tips).toEqual([
          "Archive a dataset you no longer need",
          "Upgrade the project's plan",
        ]);
      });

      /** @scenario "A handled refusal ships its remediation channel in the envelope" */
      it("spells the documentation link the way the Go plane does", async () => {
        const response = await canonicalRouteThrowing(new DatasetQuotaReachedError()).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        expect(body.error.docs_url).toBe("https://docs.langwatch.ai/datasets/limits");
        expect(body.error).not.toHaveProperty("docsUrl");
      });

      /** @scenario "A handled refusal ships its remediation channel in the envelope" */
      it("says who can act on it", async () => {
        const response = await canonicalRouteThrowing(
          new DatasetStorageUnavailableError(new Error("connection to postgres dropped")),
        ).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        expect(body.error.fault).toBe("platform");
      });
    });
  });

  describe("given a route raises a refusal made of one reason per rejected field", () => {
    describe("when the refusal is rendered", () => {
      /** @scenario "A refusal made of several facts ships its reasons chain" */
      it("ships a reason for each rejected field", async () => {
        const response = await canonicalRouteThrowing(
          new DatasetSchemaRejectedError([
            new RejectedFieldError("name"),
            new RejectedFieldError("columnTypes"),
          ]),
        ).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        const reasons = body.error.reasons as Array<Record<string, unknown>>;
        expect(reasons.map((reason) => (reason.meta as { field: string }).field)).toEqual([
          "name",
          "columnTypes",
        ]);
      });

      /** @scenario "A refusal made of several facts ships its reasons chain" */
      it("ships exactly the envelope keys the published clients read", async () => {
        const response = await canonicalRouteThrowing(
          new DatasetSchemaRejectedError([new RejectedFieldError("name")]),
        ).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        expect(Object.keys(body.error).sort()).toEqual([
          "code",
          "fault",
          "message",
          "reasons",
          "retryable",
          "type",
        ]);
      });
    });
  });

  describe("given a traced refusal carrying a reason of its own", () => {
    describe("when the refusal is rendered", () => {
      /** @scenario "A response carries one trace-id pair" */
      it("carries the trace and span ids once, on the envelope", async () => {
        const response = await canonicalRouteThrowing(
          new TracedRefusal([new TracedRejectedFieldError("name")]),
        ).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        expect(body.error.trace_id).toBe(TRACE_ID);
        expect(body.error.span_id).toBe(SPAN_ID);
      });

      /** @scenario "A response carries one trace-id pair" */
      it("repeats neither spelling on any entry of the reasons chain", async () => {
        const response = await canonicalRouteThrowing(
          new TracedRefusal([new TracedRejectedFieldError("name")]),
        ).request("/");

        const body = (await response.json()) as { error: Record<string, unknown> };
        const reasons = body.error.reasons as Array<Record<string, unknown>>;
        for (const reason of reasons) {
          expect(reason).not.toHaveProperty("traceId");
          expect(reason).not.toHaveProperty("spanId");
          expect(reason).not.toHaveProperty("trace_id");
          expect(reason).not.toHaveProperty("span_id");
        }
      });
    });
  });
});
