/** @vitest-environment node */

/**
 * tRPC and REST doors align on error handling through the shared error formatter; testing real
 * implementations, not mocks
 */

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import { trpcFailureTraceIds } from "../audit.ts";
import { createTrpcRuntimePolicy } from "../policy.ts";
import { createTrpcErrorFormatter, TrpcRootDefinition } from "../runtime.ts";

type TestContext = {
  readonly req?: { headers: Record<string, string | undefined> };
  readonly res?: { statusCode?: number };
  readonly permissionChecked: boolean;
};

/**
 * The failure a service raises when it parses its own data and loses. `.parse`, not `.safeParse`:
 * the whole defect class is the throw, and a hand-built `ZodError` would not carry the `flatten()`
 * the boundary reads.
 */
function zodFailure(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    return error;
  }

  throw new Error("Expected the parse to fail");
}

/** A rejected field the customer can see: `path` is `["name"]`. */
const pathedFailure = () =>
  zodFailure(() => z.object({ name: z.string().min(1) }).parse({ name: "" }));

/**
 * A key the schema does not list: `path` is `[]`, so `flatten()` files it under `formErrors` and
 * `fieldErrors` stays empty. This is the automation-edit failure — a transport spread three
 * command-schema keys the strict schema never listed.
 */
const unrecognizedKeysFailure = () =>
  zodFailure(() =>
    z
      .object({ triggerId: z.string() })
      .strict()
      .parse({ triggerId: "trigger-1", action: "SEND_EMAIL", triggerKind: "REPORT" }),
  );

/** What the tRPC door answered, plus what the process's reporter was told. */
type TrpcAnswer = {
  status: number;
  transportCode: string;
  handled: { code?: string; httpStatus?: number; fault?: string; meta?: Record<string, unknown> };
  captured: unknown[];
};

/**
 * One call through the real fetch handler, against a resolver that throws
 * `failure`.
 */
async function callTrpcDoor(failure: unknown): Promise<TrpcAnswer> {
  const captured: unknown[] = [];

  const root = TrpcRootDefinition.forContext<TestContext>().create({
    errorFormatter: createTrpcErrorFormatter({
      causePayload: { payloadFor: () => null },
      traceIds: trpcFailureTraceIds,
    }),
  });

  const policy = createTrpcRuntimePolicy<TestContext, TestContext>(root, {
    identity: {
      authenticate: (ctx) => ctx as TestContext,
      actor: () => ({ id: "user-1" }),
    },
    audit: { record: async () => void 0 },
    errorReporting: {
      capture: (value) => void captured.push(value),
      asError: (value) => (value instanceof Error ? value : new Error(String(value))),
    },
    causes: { translate: () => undefined },
  });

  const router = root.router({
    save: root.procedure
      .use(policy.tracerMiddleware)
      .use(policy.loggerMiddleware)
      .use(policy.handledErrorMiddleware)
      .query(() => {
        throw failure;
      }),
  });

  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request("http://api.test/trpc/save"),
    router,
    createContext: () => ({ permissionChecked: true }),
  });

  const body = (await response.json()) as {
    error?: { data?: { code?: string; error?: Record<string, unknown> | null } };
  };

  return {
    status: response.status,
    transportCode: String(body.error?.data?.code),
    handled: (body.error?.data?.error ?? {}) as TrpcAnswer["handled"],
    captured,
  };
}

/** The same throw, through the real Hono error handler. */
async function callRestDoor(failure: unknown): Promise<{ status: number; code: string }> {
  const app = new Hono();
  app.onError(createErrorHandler());

  app.get("/save", () => {
    throw failure;
  });

  const response = await app.request("/save");
  const body = (await response.json()) as { code?: string };

  return { status: response.status, code: String(body.code) };
}

describe("a bare ZodError raised inside a service", () => {
  describe("when it leaves through the tRPC door", () => {
    /** @scenario "A schema parse inside a service is a validation failure on tRPC too" */
    it("is answered as a validation failure the caller can act on, not a server fault", async () => {
      const answer = await callTrpcDoor(pathedFailure());

      expect(answer.status).toBe(422);
      expect(answer.status).toBeLessThan(500);
      expect(answer.transportCode).toBe("UNPROCESSABLE_CONTENT");

      expect(answer.handled).toMatchObject({
        code: "validation_error",
        httpStatus: 422,
        fault: "customer",
      });
    });

    /** @scenario "A schema parse inside a service is a validation failure on tRPC too" */
    it("keeps the rejected field, so the form can mark it", async () => {
      const answer = await callTrpcDoor(pathedFailure());

      expect(answer.handled.meta).toMatchObject({ fieldErrors: { name: expect.any(Array) } });
    });

    /**
     * The operational half, and the reason this was worth fixing at all: the
     * copy was already right. `handleTrpcCallLogging` reports an exception only
     * for a 5xx with no handled cause, so before the branch existed every
     * customer typo on this path arrived in the exception reporter as a bug.
     */
    /** @scenario "A validation failure is not reported as a platform exception" */
    it("is not reported to the exception reporter as an unhandled fault", async () => {
      const answer = await callTrpcDoor(pathedFailure());

      expect(answer.captured).toEqual([]);
    });

    /** @scenario "An unrecognized key answers the same validation code" */
    it("answers the same code for an unrecognized key, with no field to mark", async () => {
      const answer = await callTrpcDoor(unrecognizedKeysFailure());

      expect(answer.status).toBe(422);
      expect(answer.handled.code).toBe("validation_error");
      // `unrecognized_keys` carries an empty issue path, so there is no field
      // to attach it to. The copy for that case is the registry's, and
      // `presentation.unit.test.ts` is where it is pinned.
      expect(answer.handled.meta).toMatchObject({ fieldErrors: {} });
    });
  });

  describe("when the same throw leaves through both doors", () => {
    /** @scenario "Both API doors answer one code for one throw" */
    it("answers one code and one status, whichever door it left by", async () => {
      const failure = pathedFailure();

      const [viaTrpc, viaRest] = await Promise.all([callTrpcDoor(failure), callRestDoor(failure)]);

      expect(viaRest.code).toBe("validation_error");
      expect(viaTrpc.handled.code).toBe(viaRest.code);
      expect(viaTrpc.status).toBe(viaRest.status);
    });

    /** @scenario "Both API doors answer one code for one throw" */
    it("agrees about an unrecognized key too", async () => {
      const failure = unrecognizedKeysFailure();

      const [viaTrpc, viaRest] = await Promise.all([callTrpcDoor(failure), callRestDoor(failure)]);

      expect(viaTrpc.handled.code).toBe(viaRest.code);
      expect(viaTrpc.status).toBe(viaRest.status);
    });
  });

  describe("when it is a failure nobody named", () => {
    /** @scenario "An unnamed failure still degrades to unknown" */
    it("still degrades to a server fault rather than borrowing the validation code", async () => {
      const answer = await callTrpcDoor(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

      expect(answer.status).toBe(500);
      expect(answer.transportCode).toBe("INTERNAL_SERVER_ERROR");
      expect(answer.handled).toEqual({});
      expect(answer.captured).toHaveLength(1);
    });
  });
});
