/**
 * The declared `scenarios.*` path, as these tests need it: a runtime whose
 * authorization answers only the permissions a test grants, an audit port that
 * records rather than writes, and a stub application that fails loudly on any
 * member a test did not stub.
 */
import type { Actor } from "@langwatch/actor";
import type { TrpcContract } from "@langwatch/api/contract";
import type {
  TrpcRouterDeclaration,
  TrpcRuntimeAuditEntry,
  TrpcRuntimePorts,
} from "@langwatch/api/trpc";
import { createTrpcRuntime, redactAuditArgs } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { initTRPC } from "@trpc/server";

type TestContext = object;

/** What a read-only role holds: the view grain and nothing above it. */
export const VIEWER_PERMISSIONS: readonly AuthzPermission[] = ["scenarios:view"];

/** Every grain this surface uses, for the tests that are not about access. */
export const FULL_PERMISSIONS: readonly AuthzPermission[] = ["scenarios:view", "scenarios:manage"];

function portsGranting(
  granted: readonly AuthzPermission[],
  actor: (Actor & { id: string }) | null,
  audit: { entries: TrpcRuntimeAuditEntry[] },
): TrpcRuntimePorts<TestContext> {
  const holds = (permission: AuthzPermission) => granted.includes(permission);

  return {
    identity: { caller: () => ({ actor }) },
    authorization: {
      forRequest: () => ({
        getDecision: async (input) => ({
          permitted: holds(input.permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async (input) => ({
          permitted: input.permissions.some(holds),
          organizationRole: null,
        }),
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
 * A `ScenarioApi` that answers only what a test stubbed; any other member a
 * handler reaches fails loudly rather than answering `undefined`.
 */
export function stubScenarioApi(stubs: Partial<ScenarioApi>): ScenarioApi {
  return new Proxy({} as ScenarioApi, {
    get(_target, property) {
      const stubbed: unknown = Reflect.get(stubs, property);
      if (stubbed !== undefined) return stubbed;

      return () => {
        throw new Error(`ScenarioApi.${String(property)} was not stubbed by this test`);
      };
    },
  });
}

/** Mounts one declaration under its real namespace and answers a caller for it. */
export function scenarioTrpcCaller<Api, Contract extends TrpcContract>(options: {
  declaration: TrpcRouterDeclaration<Api, Contract>;
  app: Api;
  permissions?: readonly AuthzPermission[];
  actor?: (Actor & { id: string }) | null;
}) {
  const root = initTRPC.context<TestContext>().create();
  const audit = { entries: [] as TrpcRuntimeAuditEntry[] };
  const runtime = createTrpcRuntime<TestContext>({
    root,
    procedure: root.procedure,
    ports: portsGranting(
      options.permissions ?? FULL_PERMISSIONS,
      options.actor === undefined ? { type: "user", id: "user_1" } : options.actor,
      audit,
    ),
  });

  // Nested under the namespace, as the process mounts it: the path - and so
  // the audit row's action - is `scenarios.<procedure>`, never the bare name.
  const router = root.router({
    scenarios: options.declaration.router(runtime, () => options.app),
  });

  return { audit, router, caller: router.createCaller({}).scenarios };
}
