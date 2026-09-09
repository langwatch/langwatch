/**
 * The declared tRPC path, as these tests need it: a runtime whose ports permit
 * everything, an audit port that records rather than writes, and a factory
 * that records what each procedure declared without building one.
 */
import type { Actor } from "@langwatch/actor";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type {
  TrpcProcedureFactory,
  TrpcRouterDeclaration,
  TrpcRuntimeAuditEntry,
  TrpcRuntimePorts,
} from "@langwatch/api/trpc";
import { createTrpcRuntime, redactAuditArgs } from "@langwatch/api/trpc";
import type { TrpcContract } from "@langwatch/api/contract";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";

type TestContext = object;

/** Every check passes: these tests are about the handler, not the decision. */
function permissivePorts(
  actor: (Actor & { id: string }) | null,
  audit: { entries: TrpcRuntimeAuditEntry[] },
): TrpcRuntimePorts<TestContext> {
  return {
    identity: { caller: () => ({ actor }) },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
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
        audit.entries.push(entry);
      },
      // The REAL redaction, so a credential reaching the record fails here
      // rather than in production.
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

/**
 * An `ApiKeyApi` that answers only what a test stubbed; any other member
 * reached by a handler fails loudly rather than answering `undefined`.
 */
export function stubApiKeyApi(stubs: Partial<ApiKeyApi>): ApiKeyApi {
  return new Proxy({} as ApiKeyApi, {
    get(_target, property) {
      const stubbed: unknown = Reflect.get(stubs, property);
      if (stubbed !== undefined) return stubbed;

      return () => {
        throw new Error(`ApiKeyApi.${String(property)} was not stubbed by this test`);
      };
    },
  });
}

/** Mounts one declaration under its real namespace and answers a caller for it. */
export function apiKeyTrpcCaller<Api, Contract extends TrpcContract>(options: {
  declaration: TrpcRouterDeclaration<Api, Contract>;
  app: Api;
  actor?: (Actor & { id: string }) | null;
}) {
  const root = initTRPC.context<TestContext>().create();
  const audit = { entries: [] as TrpcRuntimeAuditEntry[] };
  const runtime = createTrpcRuntime<TestContext>({
    root,
    procedure: root.procedure,
    ports: permissivePorts(
      options.actor === undefined ? { type: "user", id: "user_1" } : options.actor,
      audit,
    ),
  });

  // Nested under the namespace, as the process mounts it: the path — and so
  // the audit row's action — is `apiKey.<procedure>`, never the bare name.
  const router = root.router({ apiKey: options.declaration.router(runtime, () => options.app) });

  return { audit, router, caller: router.createCaller({}).apiKey };
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
