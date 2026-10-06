import {
  bindTrpcFact,
  createTrpcRuntime,
  redactAuditArgs,
  type TrpcProcedureFactory,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authorization";
/**
 * The declared tRPC path, as these tests need it: a runtime whose members decide
 * what the test told them to, an audit port that records rather than writes,
 * and a factory that records what each procedure declared without building one.
 */
import type { TrpcContract } from "@langwatch/module";
import type { PresenceApi } from "@langwatch/presence-contract";
import { initTRPC } from "@trpc/server";

import { presenceSessionPersonFact } from "../presence.trpc.ts";

type TestContext = object;

type DeclaredAccess = Parameters<TrpcProcedureFactory<TestContext>["procedure"]>[0]["access"];

function members(
  actor: TrpcHandlerActor | null,
  permitted: boolean,
  audit: { entries: TrpcRuntimeAuditEntry[] },
): TrpcRuntimeMembers<TestContext> {
  return {
    identity: { caller: () => ({ actor }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: {
      record: async (entry) => {
        audit.entries.push(entry);
      },
      redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

/** Mounts the presence declaration under its real namespace and answers a caller. */
export function presenceTrpcCaller<Contract extends TrpcContract>(options: {
  declaration: TrpcRouterDeclaration<PresenceApi, Contract>;
  app: PresenceApi;
  userId?: string;
  /** The session person the door binds; Ada with no avatar unless a test says otherwise. */
  person?: { name: string | null; image: string | null } | null;
  permitted?: boolean;
}) {
  const root = initTRPC.context<TestContext>().create();
  const audit = { entries: [] as TrpcRuntimeAuditEntry[] };
  const runtime = createTrpcRuntime<TestContext>({
    root,
    procedure: root.procedure,
    members: members(
      { type: "user", id: options.userId ?? "user-1" },
      options.permitted ?? true,
      audit,
    ),
  });
  const presence = runtime.mount(options.declaration, () => options.app, {
    facts: [
      bindTrpcFact(presenceSessionPersonFact, () =>
        options.person === undefined ? { name: "Ada", image: null } : options.person,
      ),
    ],
  });
  const router = root.router({ presence });

  return { audit, router, caller: router.createCaller({}).presence };
}

/** Records the access each declared procedure asked for, building nothing. */
export function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<TestContext>, app: (ctx: TestContext) => never): unknown;
}): (AuthzPermission | DeclaredAccess)[] {
  const declared: (AuthzPermission | DeclaredAccess)[] = [];
  const runtime: TrpcProcedureFactory<TestContext> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("This test mounts but never handles a request");
  });

  return declared;
}
