/**
 * The tRPC transport: the typed root, what a server declaration refuses at
 * runtime, the one execution path a mounted procedure runs, and the wire shape
 * a failed call arrives in.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { featureApi } from "@langwatch/runtime-composition";
import type { TRPCDefaultErrorShape } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { defineTrpcContract } from "../../contract/trpc-contract.ts";
import {
  bindTrpcFact,
  bindTrpcHeader,
  browserSessionFact,
  callerAddressFact,
  createTrpcErrorFormatter,
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcProcedureFactory,
  type TrpcRouterDeclaration,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimePorts,
} from "../runtime.ts";

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

describe("TrpcRootDefinition", () => {
  it("builds a caller whose procedure receives the declared context", async () => {
    const typed = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create({});
    const router = typed.router({
      actorId: typed.procedure.query(({ ctx }) => ctx.actor.id),
    });

    await expect(router.createCaller({ actor: { id: "actor-1" } }).actorId()).resolves.toBe(
      "actor-1",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The runtime guards behind the type layer.
// ─────────────────────────────────────────────────────────────────────────────

/** A runtime that records nothing: these refusals happen before it is asked. */
const inertRuntime: TrpcProcedureFactory<object> = {
  procedure: () => ({}),
  router: (record) => record,
};

describe("binding a server to a contract at runtime", () => {
  /** @scenario "A server implementation may only name procedures the contract declared" */
  it("refuses a name the contract does not declare", () => {
    expect(() => defineTrpcRouter(ReviewApi, contract).procedure("purge" as never)).toThrow(
      /declares no procedure "purge"/,
    );
  });

  /** @scenario "A procedure cannot be implemented twice or left unimplemented" */
  it("names the procedure implemented twice, and the one never implemented", () => {
    const once = defineTrpcRouter(ReviewApi, contract)
      .procedure("getById")
      .withPermission("annotations:view")
      .handle(async () => ({ id: "annotation-1", comment: "read" }));

    expect(() => once.procedure("getById" as never)).toThrow(
      /implements procedure "getById" twice/,
    );

    // `build()` refuses at compile time; `Reflect.apply` is how the runtime
    // guard behind it is reached at all.
    const declaration: {
      router(factory: TrpcProcedureFactory<object>, app: () => ReviewApi): object;
    } = Reflect.apply(once.build, once, []);

    expect(() => declaration.router(inertRuntime, () => ({}) as ReviewApi)).toThrow(
      /no implementation for procedure "archive"/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The one execution path, end to end: trace, log, authenticate, parse, decide,
// handle, check the answer, audit, respond.
// ─────────────────────────────────────────────────────────────────────────────

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
    return processFormatter()((error as { cause?: unknown }).cause);
  }

  throw new Error("the call was expected to fail");
}

/** The process's own wire formatter, over a fixed trace id. */
function processFormatter() {
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

// ─────────────────────────────────────────────────────────────────────────────
// The tRPC failure shape, and the one property of it that is easy to lose.
//
// A validation failure is recognised STRUCTURALLY — an `issues` array and a
// `flatten` method — and never with `instanceof z.ZodError`. This workspace
// resolves two zods, and a zod 3 error travelling into zod 4 code is not an
// instance of zod 4's class, so a nominal check would turn every identity
// validation failure into an unknown 500.
//
// @see dev/docs/best_practices/zod.md
// ─────────────────────────────────────────────────────────────────────────────

const formatter = createTrpcErrorFormatter({
  causePayload: { payloadFor: () => null },
  traceIds: { find: () => "trace-1" } as never,
});

const internalShape = {
  message: "the framework's own words",
  code: -32603,
  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, stack: "…", path: "x" },
} as unknown as TRPCDefaultErrorShape;

const format = (cause: unknown) =>
  formatter({ shape: internalShape, error: { cause, code: "INTERNAL_SERVER_ERROR" } });

describe("the tRPC error formatter", () => {
  describe("given a validation failure raised by a different copy of zod", () => {
    /**
     * Built by hand rather than imported, so the test states the contract
     * instead of depending on a second install staying present: what the
     * boundary requires is the SHAPE, from whichever zod produced it.
     */
    const foreignZodError = {
      name: "ZodError",
      issues: [{ code: "invalid_type", path: ["email"], message: "Expected string" }],
      flatten: () => ({ formErrors: [], fieldErrors: { email: ["Expected string"] } }),
      message: "[{}]",
    };

    it("is not an instance of this package's zod, which is the whole point", () => {
      expect(foreignZodError instanceof z.ZodError).toBe(false);
    });

    it("still becomes a handled validation error rather than an unknown failure", () => {
      const formatted = format(foreignZodError);

      expect(formatted.message).toBe("validation_error");
      expect(formatted.data.error).toMatchObject({ code: "validation_error" });
    });

    it("carries the field errors, so a form can mark the offending input", () => {
      const formatted = format(foreignZodError);

      expect(formatted.data.error).toMatchObject({
        meta: { fieldErrors: { email: ["Expected string"] } },
      });
    });
  });

  describe("given a validation failure from this package's own zod", () => {
    it("is treated identically", () => {
      const parsed = z.object({ email: z.string() }).safeParse({ email: 1 });

      const formatted = format(parsed.success ? null : parsed.error);

      expect(formatted.message).toBe("validation_error");
    });
  });

  describe("given a failure that is not a validation error at all", () => {
    it("keeps the stack off the wire and reports no handled error", () => {
      const formatted = format(new Error("a database socket died"));

      expect(formatted.data.error).toBeNull();
      expect(formatted.data).not.toHaveProperty("stack");
    });

    it("sends a handled error's code as the message, never its prose", () => {
      class TeapotError extends HandledError {
        constructor() {
          super("validation_error", "prose no one reviewed", { httpStatus: 422 });
        }
      }

      const formatted = format(new TeapotError());

      expect(formatted.message).toBe("validation_error");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The four capabilities the declared path grew for the surfaces that could not
// state themselves honestly: a procedure with no caller, the facts a mount
// resolves, and an AND-composed permission.
//
// Spec: packages/api/specs/trpc-framework.feature.
// ─────────────────────────────────────────────────────────────────────────────

interface AccountApi {
  register(input: { email: string }): Promise<{ id: string }>;
}

const AccountApi = featureApi<AccountApi>("user");

const accountContract = defineTrpcContract("account")
  .mutation("register")
  .withInput(z.object({ email: z.string() }))
  .withOutput(z.object({ id: z.string() }))

  .mutation("changePassword")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ done: z.boolean() }))

  .query("performance")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ score: z.number() }))
  .build();

type AccountContext = {
  actor: { id: string } | null;
  req?: { headers: Record<string, string | string[] | undefined> };
  sessionId?: string;
};

const accountRoot = TrpcRootDefinition.forContext<AccountContext>().create({});

const accountApp: AccountApi = { register: async () => ({ id: "user-1" }) };

/** Records every permission the path asked about, and what it was told. */
function accountHarness({
  caller,
  permitted = () => true,
}: {
  caller?: (ctx: AccountContext) => { actor: { type: "user"; id: string } | null };
  permitted?: (permission: string) => boolean;
} = {}) {
  const asked: string[] = [];
  const rows: TrpcRuntimeAuditEntry[] = [];

  const ports: TrpcRuntimePorts<AccountContext> = {
    identity: {
      caller:
        caller ?? ((ctx) => ({ actor: ctx.actor ? { type: "user", id: ctx.actor.id } : null })),
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => {
          asked.push(permission);

          return { permitted: permitted(permission), organizationRole: null };
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
      redact: ({ args }) => args,
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  return {
    asked,
    rows,
    ports,
    runtime: (anonymousProcedure?: typeof accountRoot.procedure) =>
      createTrpcRuntime({
        root: accountRoot,
        procedure: accountRoot.procedure,
        ...(anonymousProcedure ? { anonymousProcedure } : {}),
        ports,
      }),
  };
}

/** The three procedures, with whatever each capability's test needs of them. */
function accountRouter(
  declare: (builder: ReturnType<typeof defineTrpcRouter<AccountApi, typeof accountContract>>) => {
    build(): TrpcRouterDeclaration<AccountApi, typeof accountContract>;
  },
) {
  return declare(defineTrpcRouter(AccountApi, accountContract)).build();
}

const plainAccountRouter = () =>
  accountRouter((builder) =>
    builder
      .procedure("register")
      .withAccess(publicRoute({ reason: "signing up predates the account it creates" }))
      .handle((async () => ({ id: "user-1" })) as never)

      .procedure("changePassword")
      .withPermission("annotations:update")
      .handle((async () => ({ done: true })) as never)

      .procedure("performance")
      .withPermission(["evaluations:view", "analytics:view"])
      .handle((async () => ({ score: 1 })) as never),
  );

describe("a procedure that runs with no caller", () => {
  describe("given the runtime was given the process's anonymous procedure", () => {
    /** @scenario "A procedure that runs with no caller is declared, not assumed" */
    it("hands the handler a null actor and a null scope, and asks identity nothing", async () => {
      const seen: Record<string, unknown>[] = [];

      const harness = accountHarness({
        caller: () => {
          throw new Error("the identity port was asked about an anonymous caller");
        },
      });

      const declaration = accountRouter((builder) =>
        builder
          .procedure("register")
          .withAccess(publicRoute({ reason: "signing up predates the account it creates" }))
          .handle((async (args: Record<string, unknown>) => {
            seen.push({ ...args });

            return { id: "user-1" };
          }) as never)

          .procedure("changePassword")
          .withPermission("annotations:update")
          .handle((async () => ({ done: true })) as never)

          .procedure("performance")
          .withPermission(["evaluations:view", "analytics:view"])
          .handle((async () => ({ score: 1 })) as never),
      );

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(declaration, () => accountApp)
        .createCaller({ actor: null });

      await expect(caller.register({ email: "someone@example.com" })).resolves.toEqual({
        id: "user-1",
      });

      expect(seen[0]).toMatchObject({ actor: null, scope: null });
    });

    /** @scenario "A procedure that runs with no caller is declared, not assumed" */
    it("writes no audit row for it, because nobody is behind the request", async () => {
      const harness = accountHarness({
        caller: () => {
          throw new Error("the identity port was asked about an anonymous caller");
        },
      });

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(plainAccountRouter(), () => accountApp)
        .createCaller({ actor: null });

      await caller.register({ email: "someone@example.com" });

      expect(harness.rows).toEqual([]);
    });
  });

  describe("given the runtime was given no anonymous procedure", () => {
    /** @scenario "A procedure that runs with no caller is declared, not assumed" */
    it("refuses the mount, naming the procedure", () => {
      const harness = accountHarness();

      expect(() => harness.runtime().mount(plainAccountRouter(), () => accountApp)).toThrow(
        /account\.register answers with no caller, and this runtime was given no anonymous procedure/,
      );
    });
  });

  describe("given the declaration is written badly", () => {
    /** @scenario "A procedure that runs with no caller is declared, not assumed" */
    it("refuses a blank reason, and an input that names a tenant", () => {
      expect(() => publicRoute({ reason: "  " })).toThrow(/needs a written reason/);

      expect(() =>
        defineTrpcRouter(AccountApi, accountContract)
          .procedure("changePassword")
          .withAccess(publicRoute({ reason: "the sign-up form calls it" })),
      ).toThrow(/account\.changePassword runs with no caller and its input names projectId/);
    });
  });
});

describe("a procedure that declares a fact", () => {
  const sessionRouter = () =>
    accountRouter((builder) =>
      builder
        .procedure("register")
        .withFacts(callerAddressFact)
        .withAccess(publicRoute({ reason: "signing up predates the account it creates" }))
        .handle((async (_args: never, address: string | null) => ({
          id: address ?? "none",
        })) as never)

        .procedure("changePassword")
        .withFacts(browserSessionFact, callerAddressFact)
        .withPermission("annotations:update")
        .handle((async (_args: never, session: string | null, address: string | null) => ({
          done: session === "session-1" && address === "203.0.113.7",
        })) as never)

        .procedure("performance")
        .withPermission(["evaluations:view", "analytics:view"])
        .handle((async () => ({ score: 1 })) as never),
    );

  describe("given the mount bound one value for each", () => {
    /** @scenario "A tRPC procedure reads a fact its mount resolved, never the request" */
    it("hands them to the handler after its arguments, in the order it declared them", async () => {
      const harness = accountHarness();

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(sessionRouter(), () => accountApp, {
          facts: [
            bindTrpcFact(browserSessionFact, (ctx: AccountContext) => ctx.sessionId ?? null),
            bindTrpcHeader(callerAddressFact, "x-forwarded-for"),
          ],
        })
        .createCaller({
          actor: { id: "user-1" },
          sessionId: "session-1",
          req: { headers: { "x-forwarded-for": "203.0.113.7" } },
        });

      await expect(caller.changePassword({ projectId: "project-1" })).resolves.toEqual({
        done: true,
      });
    });

    /** @scenario "A tRPC procedure reads a fact its mount resolved, never the request" */
    it("reads the address off the header the mount named, for an anonymous procedure too", async () => {
      const harness = accountHarness();

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(sessionRouter(), () => accountApp, {
          facts: [
            bindTrpcFact(browserSessionFact, () => null),
            bindTrpcHeader(callerAddressFact, "x-forwarded-for"),
          ],
        })
        .createCaller({ actor: null, req: { headers: { "x-forwarded-for": "198.51.100.4" } } });

      await expect(caller.register({ email: "someone@example.com" })).resolves.toEqual({
        id: "198.51.100.4",
      });
    });
  });

  describe("given the mount bound no value for one of them", () => {
    /** @scenario "A tRPC procedure reads a fact its mount resolved, never the request" */
    it("refuses the mount, naming the fact and the procedure", () => {
      const harness = accountHarness();

      expect(() =>
        harness.runtime(accountRoot.procedure).mount(sessionRouter(), () => accountApp, {
          facts: [bindTrpcFact(browserSessionFact, () => null)],
        }),
      ).toThrow(
        /account\.register declares the fact "callerAddress", and this mount bound no value for it/,
      );
    });
  });
});

describe("a procedure that names several permissions together", () => {
  describe("given the caller holds every one of them", () => {
    /** @scenario "A procedure may require several permissions together" */
    it("asks about each before the handler runs, at the scope the input names", async () => {
      const harness = accountHarness();

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(plainAccountRouter(), () => accountApp)
        .createCaller({ actor: { id: "user-1" } });

      await expect(caller.performance({ projectId: "project-1" })).resolves.toEqual({ score: 1 });
      expect(harness.asked).toEqual(["evaluations:view", "analytics:view"]);
    });
  });

  describe("given the caller holds only the first", () => {
    /** @scenario "A procedure may require several permissions together" */
    it("refuses with one code, naming the permission it stopped on, and never runs the handler", async () => {
      const ran: string[] = [];

      const harness = accountHarness({
        permitted: (permission) => permission === "evaluations:view",
      });

      const declaration = accountRouter((builder) =>
        builder
          .procedure("register")
          .withAccess(publicRoute({ reason: "signing up predates the account it creates" }))
          .handle((async () => ({ id: "user-1" })) as never)

          .procedure("changePassword")
          .withPermission("annotations:update")
          .handle((async () => ({ done: true })) as never)

          .procedure("performance")
          .withPermission(["evaluations:view", "analytics:view"])
          .handle((async () => {
            ran.push("performance");

            return { score: 1 };
          }) as never),
      );

      const caller = harness
        .runtime(accountRoot.procedure)
        .mount(declaration, () => accountApp)
        .createCaller({ actor: { id: "user-1" } });

      const failure = await caller.performance({ projectId: "project-1" }).catch((error) => error);

      expect(HandledError.isHandled((failure as { cause?: unknown }).cause)).toBe(true);
      expect((failure as { cause: { code: string } }).cause.code).toBe("permission_denied");

      expect((failure as { cause: { meta: Record<string, unknown> } }).cause.meta).toMatchObject({
        permission: "analytics:view",
      });
      expect(ran).toEqual([]);
      expect(harness.asked).toEqual(["evaluations:view", "analytics:view"]);
    });
  });

  describe("given the set could never be asked at one scope", () => {
    /** @scenario "A procedure may require several permissions together" */
    it("refuses a set of one, a repeat, and one no single scope grants", () => {
      const select = () => defineTrpcRouter(AccountApi, accountContract).procedure("performance");

      expect(() => select().withPermission(["evaluations:view"] as never)).toThrow(
        /names 1 permissions to check together/,
      );

      expect(() =>
        select().withPermission(["evaluations:view", "evaluations:view"] as never),
      ).toThrow(/names one permission twice/);

      expect(() => select().withPermission(["evaluations:view", "ops:view"] as never)).toThrow(
        /no one scope grants them all/,
      );
    });
  });
});
