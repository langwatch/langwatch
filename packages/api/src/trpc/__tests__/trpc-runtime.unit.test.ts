/**
 * The one execution path a declared tRPC procedure runs, end to end: trace,
 * log, authenticate, parse, decide, handle, check the answer, audit, respond.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { featureApi } from "@langwatch/runtime-composition/contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../../contract/trpc-contract.ts";
import { createTrpcErrorFormatter } from "../trpc-error-formatter.ts";
import { TrpcRootDefinition } from "../trpc-root.ts";
import { defineTrpcRouter } from "../trpc-router.ts";
import {
  createTrpcRuntime,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimePorts,
} from "../trpc-runtime.ts";

const logged: unknown[] = [];

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (fields: unknown, message: string) => {
      logged.push({ fields, message });
    },
  }),
  validationMeta: (error: { issues: { path: PropertyKey[]; code: string }[] }) => ({
    issueCount: error.issues.length,
    issues: error.issues.map((issue) => ({ path: "<redacted>", code: issue.code })),
  }),
}));

interface ReviewApi {
  read(input: { id: string }): Promise<{ id: string; comment: string }>;
}

const ReviewApi = featureApi<ReviewApi>("annotation");

const contract = defineTrpcContract("review")
  .query("getById")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ id: z.string(), comment: z.string() }))

  .mutation("archive")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .build();

type ReviewContext = { actor: { id: string } };

const root = TrpcRootDefinition.forContext<ReviewContext>().create({});

/** Records every step the path runs, in the order it runs them. */
function harness() {
  const steps: string[] = [];
  const rows: TrpcRuntimeAuditEntry[] = [];

  const ports: TrpcRuntimePorts<ReviewContext> = {
    identity: {
      caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }),
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission, scope }) => {
          steps.push(`decide:${permission}:${scope.tier}:${scope.id}`);

          return { permitted: true, organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: {
      record: async (entry) => {
        rows.push(entry);
      },
      redact: ({ args }) => ({ ...(args as object), redacted: true }),
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  return { steps, rows, runtime: createTrpcRuntime({ root, procedure: root.procedure, ports }) };
}

function reviewRouter(handle: {
  getById: (args: never) => unknown;
  archive?: (args: never) => unknown;
}) {
  return defineTrpcRouter(ReviewApi, contract)
    .procedure("getById")
    .withPermission("annotations:view")
    .handle(handle.getById as never)

    .procedure("archive")
    .withPermission("annotations:delete")
    .handle((handle.archive ?? (async () => {})) as never)
    .build();
}

beforeEach(() => {
  logged.length = 0;
});

describe("a mounted contract procedure", () => {
  describe("given a caller invokes it", () => {
    /** @scenario "A tRPC check reads the validated input, never the unparsed request" */
    it("parses, decides on the declared target, handles and checks the answer", async () => {
      const { steps, runtime } = harness();
      const app: ReviewApi = { read: async ({ id }) => ({ id, comment: "read" }) };

      const declaration = reviewRouter({
        getById: (async (args: { app: ReviewApi; input: { id: string } }) => {
          steps.push("handle");

          return args.app.read({ id: args.input.id });
        }) as never,
      });

      const caller = runtime
        .mount(declaration, () => app)
        .createCaller({ actor: { id: "reviewer-1" } });

      const answer = await caller.getById({ projectId: "project-1", id: "annotation-1" });

      expect(answer).toEqual({ id: "annotation-1", comment: "read" });
      expect(steps).toEqual(["decide:annotations:view:project:project-1", "handle"]);
    });

    /** @scenario "A tRPC call runs one execution path" */
    it("hands the handler input, app, actor, scope and signal, and keeps facts out of input", async () => {
      const { runtime } = harness();
      const seen: Record<string, unknown>[] = [];
      const app: ReviewApi = { read: async ({ id }) => ({ id, comment: "read" }) };

      const declaration = reviewRouter({
        getById: (async (args: { input: { id: string } }) => {
          seen.push({ ...args });

          return { id: args.input.id, comment: "read" };
        }) as never,
      });

      const caller = runtime
        .mount(declaration, () => app)
        .createCaller({ actor: { id: "reviewer-1" } });

      await caller.getById({ projectId: "project-1", id: "annotation-1" });

      const args = seen[0]!;
      expect(Object.keys(args).sort()).toEqual(["actor", "app", "input", "scope", "signal"]);
      expect(args.scope).toEqual({ tier: "project", id: "project-1" });
      expect(args.actor).toEqual({ type: "user", id: "reviewer-1" });
      expect(args.input).toEqual({ projectId: "project-1", id: "annotation-1" });
      expect(Object.keys(args.input as object)).not.toContain("scope");
    });

    /** @scenario "A mutation is recorded with the arguments its owner redacted" */
    it("writes one audit row for a mutation, with the arguments the owner redacted", async () => {
      const { rows, runtime } = harness();
      const app: ReviewApi = { read: async ({ id }) => ({ id, comment: "read" }) };

      const caller = runtime
        .mount(reviewRouter({ getById: (async () => ({})) as never }), () => app)
        .createCaller({ actor: { id: "reviewer-1" } });

      await caller.archive({ projectId: "project-1", id: "annotation-1" });

      expect(rows).toHaveLength(1);

      expect(rows[0]).toMatchObject({
        userId: "reviewer-1",
        projectId: "project-1",
        action: "archive",
        args: { projectId: "project-1", id: "annotation-1", redacted: true },
      });
    });
  });

  describe("given the handler answers a shape its declaration refuses", () => {
    /** @scenario "An output the declaration refuses is diagnosed without leaking the response" */
    it("logs the procedure and the issue path, never the body, and still answers the caller", async () => {
      const { runtime } = harness();
      const app: ReviewApi = { read: async ({ id }) => ({ id, comment: "read" }) };

      const declaration = reviewRouter({
        getById: (async () => ({ id: "annotation-1", comment: 7 })) as never,
      });

      const caller = runtime
        .mount(declaration, () => app)
        .createCaller({ actor: { id: "reviewer-1" } });

      const answer = await caller.getById({ projectId: "project-1", id: "annotation-1" });

      expect(answer).toEqual({ id: "annotation-1", comment: 7 });
      const record = logged[0] as { fields: Record<string, unknown>; message: string };
      expect(record.fields.endpoint).toBe("review.getById");
      expect(record.fields.protocol).toBe("trpc");

      expect(record.fields.validation).toEqual({
        issueCount: 1,
        issues: [{ path: "<redacted>", code: "invalid_type" }],
      });

      expect(JSON.stringify(record)).not.toContain("annotation-1");
    });
  });

  describe("given the handler throws", () => {
    /** @scenario "Handled failures cross the boundary as handled errors" */
    it("carries a handled code and status, and degrades a plain Error to unknown with a trace id", async () => {
      const { runtime } = harness();
      const app: ReviewApi = { read: async () => Promise.reject(new Error("boom")) };

      const declaration = reviewRouter({
        getById: (async () => {
          throw new NotFoundError("annotation_not_found", "Annotation", "annotation-1");
        }) as never,
        archive: (async () => {
          throw new Error("the database refused the write");
        }) as never,
      });

      const caller = runtime
        .mount(declaration, () => app)
        .createCaller({ actor: { id: "reviewer-1" } });

      const handled = await onTheWire(
        caller.getById({ projectId: "project-1", id: "annotation-1" }),
      );

      expect(handled.message).toBe("annotation_not_found");
      expect(handled.data.error).toMatchObject({ code: "annotation_not_found", httpStatus: 404 });

      const unknown = await onTheWire(
        caller.archive({ projectId: "project-1", id: "annotation-1" }),
      );

      expect(unknown.data.error).toBeNull();
      expect(unknown.message).toBe(HandledError.toUserMessage(new Error("x")));
      expect(unknown.data.traceId).toBe("trace-1");
    });
  });
});

/** The wire shape a failed call arrives in, through the process's own formatter. */
async function onTheWire(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    return formatter()((error as { cause?: unknown }).cause);
  }

  throw new Error("the call was expected to fail");
}

/** The process's own wire formatter, over a fixed trace id. */
function formatter() {
  const format = createTrpcErrorFormatter({
    causePayload: { payloadFor: () => null },
    traceIds: { find: () => "trace-1" } as never,
  });

  return (cause: unknown) =>
    format({
      shape: {
        message: "the framework's own words",
        code: -32603,
        data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, stack: "…", path: "x" },
      } as never,
      error: { cause, code: "INTERNAL_SERVER_ERROR" },
    });
}
