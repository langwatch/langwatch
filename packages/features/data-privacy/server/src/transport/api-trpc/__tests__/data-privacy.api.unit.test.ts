/**
 * @vitest-environment node
 *
 * The `dataPrivacy.*` surface: the three procedures the settings screen calls,
 * the gates they declare, the shapes they accept, and the two failures they
 * translate.
 *
 * The answers all come from ports, so this transport owns none of them. What
 * it does own is worth pinning. The scope tiers and the durable configuration
 * parser are the contract's, so a rule the browser may send is a rule the
 * table may hold. The write translates the two refusals a caller can act on
 * and rethrows everything else untouched. And removal deliberately translates
 * nothing — it has never answered `NOT_FOUND` for a target that is gone.
 */
import {
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
} from "@langwatch/data-privacy-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { DataPrivacyTrpcApi, type DataPrivacyTrpcPorts } from "../data-privacy.api";

type TestContext = { session: { user: { id: string } } | null };

type Snapshot = { effective: { secrets: boolean }; rules: string[] };
type Rule = { id: string; scopeId: string };

const PROJECT_SCOPE = { scopeType: "PROJECT", scopeId: "project-1" } as const;
const EMPTY_CONFIG: DataPrivacyConfig = {};

function harness(overrides: Partial<DataPrivacyTrpcPorts<Snapshot, Rule>> = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: ctx.session } });
  });

  const declared: string[] = [];
  const parsedInputs: unknown[] = [];
  const recordingDecorator =
    (name: string) =>
    <TProcedure>(procedure: TProcedure): TProcedure => {
      declared.push(name);
      return (procedure as { use(middleware: unknown): TProcedure }).use(
        ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
          parsedInputs.push(input);
          return next();
        },
      );
    };

  const ports: DataPrivacyTrpcPorts<Snapshot, Rule> = {
    getSnapshot: vi.fn(async () => ({ effective: { secrets: true }, rules: [] })),
    setForScope: vi.fn(async () => ({ id: "rule-1", scopeId: "project-1" })),
    removeForScope: vi.fn(async () => {}),
    ...overrides,
  };

  const router = DataPrivacyTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: (permission) => recordingDecorator(permission),
      scopeWritePolicy: recordingDecorator("scopeWritePolicy"),
      scopeRemovalPolicy: recordingDecorator("scopeRemovalPolicy"),
    },
    ports,
  );

  return {
    declared,
    parsedInputs,
    ports,
    caller: router.createCaller({ session: { user: { id: "reader" } } }),
    anonymousCaller: router.createCaller({ session: null }),
  };
}

describe("DataPrivacyTrpcApi", () => {
  describe("given a signed-in reader", () => {
    it("answers the snapshot with the port's own shape", async () => {
      const snapshot = { effective: { secrets: false }, rules: ["organization"] };
      const { caller } = harness({ getSnapshot: async () => snapshot });

      await expect(caller.getSnapshot({ projectId: "project-1" })).resolves.toBe(snapshot);
    });

    /**
     * The snapshot filters the rules and the writable scopes it returns by
     * what the caller may see, so a wider gate here would not widen the
     * answer — and a narrower one would hide the screen from a project reader.
     */
    it("declares project:view on the read", () => {
      expect(harness().declared[0]).toBe("project:view");
    });

    it("declares the process's resolver-authorized checks on the two writes", () => {
      expect(harness().declared).toEqual([
        "project:view",
        "scopeWritePolicy",
        "scopeRemovalPolicy",
      ]);
    });
  });

  describe("given a caller writing a rule at a scope", () => {
    it("forwards the validated target and hands back the written rule", async () => {
      const rule = { id: "rule-9", scopeId: "team-1" };
      const { caller, ports } = harness({ setForScope: vi.fn(async () => rule) });

      await expect(
        caller.setForScope({
          projectId: "project-1",
          scope: { scopeType: "TEAM", scopeId: "team-1" },
          personalOnly: true,
          config: EMPTY_CONFIG,
        }),
      ).resolves.toBe(rule);
      expect(ports.setForScope).toHaveBeenCalledTimes(1);
      expect(vi.mocked(ports.setForScope).mock.calls[0]?.[1]).toEqual({
        projectId: "project-1",
        scope: { scopeType: "TEAM", scopeId: "team-1" },
        personalOnly: true,
        config: EMPTY_CONFIG,
      });
    });

    it("refuses a scope tier the contract does not enumerate", async () => {
      const { caller, ports } = harness();

      await expect(
        (caller as unknown as { setForScope(input: unknown): Promise<unknown> }).setForScope({
          projectId: "project-1",
          scope: { scopeType: "WORKSPACE", scopeId: "anything" },
          personalOnly: false,
          config: EMPTY_CONFIG,
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(ports.setForScope).not.toHaveBeenCalled();
    });

    it("refuses a configuration the contract's parser rejects", async () => {
      const { caller, ports } = harness();

      await expect(
        (caller as unknown as { setForScope(input: unknown): Promise<unknown> }).setForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
          config: { notAField: true },
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(ports.setForScope).not.toHaveBeenCalled();
    });
  });

  describe("when the write hits a scope target that does not exist", () => {
    it("answers NOT_FOUND, carrying the refusal's own words", async () => {
      const { caller } = harness({
        setForScope: async () => {
          throw new ScopeTargetNotFoundError("No such team.");
        },
      });

      await expect(
        caller.setForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
          config: EMPTY_CONFIG,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "No such team." });
    });
  });

  describe("when the service refuses the configuration", () => {
    it("answers BAD_REQUEST, so the screen can say which rule was rejected", async () => {
      const { caller } = harness({
        setForScope: async () => {
          throw new InvalidDataPrivacyConfigError("Pattern is not safe to run.");
        },
      });

      await expect(
        caller.setForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
          config: EMPTY_CONFIG,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pattern is not safe to run." });
    });
  });

  describe("when the write fails for a reason this surface cannot name", () => {
    /**
     * Dressing an unrecognised failure up as one of the two above would
     * promise the caller an action they do not have. It stays what it was and
     * degrades to the generic unknown plus a trace id.
     */
    it("rethrows it untouched, so tRPC reports the generic failure", async () => {
      const failure = new Error("the database went away");
      const { caller } = harness({
        setForScope: async () => {
          throw failure;
        },
      });

      await expect(
        caller.setForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
          config: EMPTY_CONFIG,
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: failure });
    });
  });

  describe("given a caller removing a rule", () => {
    it("forwards the validated target and answers nothing", async () => {
      const { caller, ports } = harness();

      await expect(
        caller.removeForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
        }),
      ).resolves.toBeUndefined();
      expect(vi.mocked(ports.removeForScope).mock.calls[0]?.[1]).toEqual({
        projectId: "project-1",
        scope: PROJECT_SCOPE,
        personalOnly: false,
      });
    });

    /**
     * Removal has never translated either refusal. A removal that starts
     * answering `NOT_FOUND` for a target that is already gone is a change to
     * what its callers see, not a tidy-up.
     */
    it("leaves a missing target failing the way it always has", async () => {
      const failure = new ScopeTargetNotFoundError("No such team.");
      const { caller } = harness({
        removeForScope: async () => {
          throw failure;
        },
      });

      await expect(
        caller.removeForScope({
          projectId: "project-1",
          scope: PROJECT_SCOPE,
          personalOnly: false,
        }),
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: failure });
    });
  });

  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware where `.input()` is
     * called, so anything installed before it runs with `input === undefined`
     * — including the scope-lineage guard, which compares the ids in the
     * input against one another.
     */
    it("hands each policy the parsed input, not undefined", async () => {
      const { caller, parsedInputs } = harness();

      await caller.getSnapshot({ projectId: "project-1" });
      await caller.removeForScope({
        projectId: "project-1",
        scope: PROJECT_SCOPE,
        personalOnly: false,
      });

      expect(parsedInputs).toEqual([
        { projectId: "project-1" },
        { projectId: "project-1", scope: PROJECT_SCOPE, personalOnly: false },
      ]);
    });
  });

  describe("when the caller has no session", () => {
    it("refuses on the process's authenticated procedure", async () => {
      const { anonymousCaller, ports } = harness();

      await expect(anonymousCaller.getSnapshot({ projectId: "project-1" })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(ports.getSnapshot).not.toHaveBeenCalled();
    });
  });
});
