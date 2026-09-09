/**
 * The declared tRPC path, as these tests need it: a runtime whose ports decide
 * what the test told them to, an audit port that records rather than writes,
 * and a factory that records what each procedure declared without building one.
 */
import type { TrpcContract } from "@langwatch/api/contract";
import {
  createTrpcRuntime,
  redactAuditArgs,
  type TrpcProcedureFactory,
  type TrpcHandlerActor,
  type TrpcRouterDeclaration,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimePorts,
} from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { initTRPC } from "@trpc/server";

type TestContext = object;

function ports(
  actor: TrpcHandlerActor | null,
  permitted: boolean,
  audit: { entries: TrpcRuntimeAuditEntry[] },
): TrpcRuntimePorts<TestContext> {
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
  permitted?: boolean;
}) {
  const root = initTRPC.context<TestContext>().create();
  const audit = { entries: [] as TrpcRuntimeAuditEntry[] };
  const runtime = createTrpcRuntime<TestContext>({
    root,
    procedure: root.procedure,
    ports: ports(
      { type: "user", id: options.userId ?? "user-1" },
      options.permitted ?? true,
      audit,
    ),
  });
  const router = root.router({ presence: options.declaration.router(runtime, () => options.app) });

  return { audit, router, caller: router.createCaller({}).presence };
}

/** Records the access each declared procedure asked for, building nothing. */
export function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<TestContext>, app: (ctx: TestContext) => never): unknown;
}): (AuthzPermission | AuthzDeclaration)[] {
  const declared: (AuthzPermission | AuthzDeclaration)[] = [];
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
