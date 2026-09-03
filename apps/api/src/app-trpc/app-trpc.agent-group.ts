/**
 * The six tRPC surfaces an AGENT is written, watched and driven through,
 * mounted as one group on the process's own root.
 *
 *   scenarios      the test cases a project defines, the runs they produced,
 *                  and the live stream a simulation reports itself on.
 *   suites         the folders and suites those cases are grouped into, and the
 *                  suite runs over them.
 *   langy          the conversation panel: the slim spine, one conversation's
 *                  messages, the turn-start commands, and the two live channels
 *                  a running turn is watched through.
 *   langyEgress    the per-project allow-list that bounds what the agent behind
 *                  that panel may reach.
 *   ops            the operator back office, which is the only surface here
 *                  whose gate is the deployment's admin allow-list rather than
 *                  a project permission.
 *   setupSkills    the instructions an empty state hands a coding agent, which
 *                  are the compiled skills the Langy image itself ships.
 *
 * ## Why one group rather than six entries
 *
 * They are one graph in the only sense a composition root cares about: every
 * one of them either drives an agent or reads what an agent did. A scenario run
 * IS an agent conversation scored against a criterion; a Langy turn IS an agent
 * conversation the customer is in; a suite is a set of the first; the setup
 * skills are the instructions the agent runs; and the operator surface is where
 * the queues those runs travel on are read. Naming them individually on
 * {@link AppTrpcFeaturePorts} would put six entries on a file that four other
 * halves of the record also edit; naming them once here keeps the shared file's
 * diff to one import, one parameter and one spread.
 *
 * ## The three subscriptions
 *
 * `scenarios.onSimulationUpdate`, `langy.onConversationUpdate` and
 * `langy.onTurnStream` are in this record, not beside it. A subscription
 * mounted beside the record would be callable over `/api/trpc` and un-watchable
 * over `/api/sse`, because the SSE lane resolves its path against a caller
 * built from the record the process mounted. With these three inside it, all
 * ten of the browser's subscriptions are served by this process's own root.
 *
 * Two of the three stream off an emitter the PROCESS owns — the tenant
 * broadcast presence already publishes on — which is why they keep working on a
 * deployment whose queue is absent: nothing starts, but a browser still learns
 * what arrived. The third, `onTurnStream`, tails a durable Redis buffer and
 * simply yields nothing without one, which is the answer the transport already
 * documents ("no Redis ⇒ no live buffer; the client falls back to the Postgres
 * conversation/message query").
 */
import type { TrpcApiMount, TrpcApiPublicMount } from "@langwatch/api/trpc";
import type {
  LangyEgressTrpcContext,
  LangyEgressTrpcPorts,
  LangyTrpcContext,
  LangyTrpcPorts,
  SetupSkillsTrpcContext,
} from "@langwatch/langy-server";
import type { OpsTrpcContext, OpsTrpcPorts } from "@langwatch/ops-server";
import type { ScenarioTrpcContext, ScenarioTrpcPorts } from "@langwatch/scenario-server";
import type { SuiteTrpcContext } from "@langwatch/suite-server";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

import {
  createLangyEgressTrpcRouter,
  createLangyTrpcRouter,
  type LangyTrpcGates,
} from "../features/langy/langy-trpc.mount";
import { createSetupSkillsTrpcRouter } from "../features/langy/setup-skills-trpc.mount";
import { createOpsTrpcRouter } from "../features/ops/ops-trpc.mount";
import { createScenarioTrpcRouter } from "../features/scenario/scenario-trpc.mount";
import { createSuiteTrpcRouter } from "../features/suite/suite-trpc.mount";
import type { AppTrpcDeclaredCheck, AppTrpcPolicyKit } from "./app-trpc.policy-kit";

/**
 * The request context this group is resolved against: the intersection of the
 * six surfaces' own contexts.
 *
 * Written down once for the same reason {@link ApiTrpcFeatureApplication} is —
 * so "what must a request carry for the whole group to mount" is one statement
 * rather than six compile errors.
 */
export type AppAgentGroupTrpcContext = LangyEgressTrpcContext &
  LangyTrpcContext &
  OpsTrpcContext &
  ScenarioTrpcContext &
  SetupSkillsTrpcContext &
  SuiteTrpcContext;

/**
 * The capabilities the six surfaces reach that their own feature packages do
 * not own.
 *
 * Two of them take NOTHING and are absent from this interface entirely.
 * `suites` answers wholly from `ctx.app.suites`, and `setupSkills` answers from
 * a catalogue the package itself compiles in. That is not an oversight to be
 * tidied up later: a surface with no port is a surface a deployment cannot get
 * wrong.
 */
export interface AppAgentGroupTrpcPorts {
  /**
   * The two fire-and-forget signals a newly written test case triggers —
   * product analytics and the "you have written N test cases" nurturing
   * sequence — plus where a failure in either goes instead of the caller.
   *
   * All three are the deployment's marketing and telemetry rather than
   * Scenario's, and none of them may fail a create.
   */
  scenarios: ScenarioTrpcPorts;
  /**
   * The message and warm budgets, the product-analytics sink, and the
   * agent-to-page UI-action channel's claim/complete half.
   *
   * The budgets are Redis counters this deployment owns; the channel is a
   * Redis-backed handshake between a running agent and the tab in front of the
   * customer, which is the process's because both ends are.
   */
  langy: LangyTrpcPorts;
  /**
   * The two Langy gates every customer-facing procedure carries, already built.
   *
   * Middlewares rather than descriptions because neither is a permission: the
   * first compares the input's project against the deployment's demo project,
   * and the second evaluates a rollout rule against the caller and the
   * project's organization. `declaredCheckFrom` refuses exactly that shape.
   */
  langyGates: LangyTrpcGates;
  /** The audit trail an egress allow-list change is recorded on. */
  langyEgress: LangyEgressTrpcPorts;
  /**
   * The pipeline registry, the event-log search window, the Grafana deep links
   * and the in-place system-migrations runner.
   *
   * Every one of them is the PROCESS's own runtime rather than an operations
   * service's: which projections this deployment registered, how far back its
   * event log is warm, where its dashboards live, and which migrations it has
   * run.
   */
  ops: OpsTrpcPorts;
  /**
   * The operator gate, already built.
   *
   * The other five surfaces take the ordinary declared-permission policy the
   * mount builds from `createTrpcApiService`. This one cannot: it is a
   * `kind: "custom"` declaration that resolves the admin allow-list rather than
   * reading a scope id out of the input, and `declaredCheckFrom` refuses to
   * build a custom check from a description of one. So the composition hands
   * over the middleware itself, and the rest of the operator chain is assembled
   * here from the mount's own middlewares — see {@link opsPolicyKit}.
   */
  opsCheck(input: {
    permission: AuthzPermission;
    throwOnDeny?: boolean;
  }): AppTrpcDeclaredCheck;
}

/**
 * The group's ports, for a host that publishes no client type.
 *
 * There are no type parameters to widen — unlike the trace group, none of these
 * six surfaces is generic in a row shape a client sees — so the alias is the
 * interface itself, stated for symmetry with the other groups rather than to
 * erase anything.
 */
export type AnyAppAgentGroupTrpcPorts = AppAgentGroupTrpcPorts;

/**
 * Builds all six surfaces against one process's mount.
 *
 * The result is keyed by the namespace each answers on, so the caller spreads
 * it into the record and adds nothing per feature.
 */
export function createAppAgentGroupTrpcFeatures<
  TContext extends AppAgentGroupTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends AnyAppAgentGroupTrpcPorts,
>(options: {
  mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPublicMount<TContext, TOptions, TRoot>;
  ports: TPorts;
}) {
  const { mount, ports } = options;

  return {
    // Carries `onConversationUpdate` and `onTurnStream`. In the record rather
    // than beside it: see the module docblock.
    langy: createLangyTrpcRouter({ ...mount, ports: ports.langy, gates: ports.langyGates }),
    // Beside the conversation surface because both carry the same two gates and
    // the same application; the wire name stays `langyEgress` so no action path
    // moves.
    langyEgress: createLangyEgressTrpcRouter({
      ...mount,
      ports: ports.langyEgress,
      gates: ports.langyGates,
    }),
    ops: createOpsTrpcRouter({
      root: mount.root,
      protectedProcedure: mount.protectedProcedure,
      policy: opsPolicyKit(mount.middlewares, ports.opsCheck),
      ports: ports.ops,
    }),
    // Carries `onSimulationUpdate`, for the same reason.
    scenarios: createScenarioTrpcRouter({ ...mount, ports: ports.scenarios }),
    // Takes no ports: the catalogue is a compiled artifact the Langy package
    // holds, so there is nothing for a deployment to answer.
    setupSkills: createSetupSkillsTrpcRouter(mount),
    // Takes no ports either — a suite, its folders and its runs are all read
    // through `ctx.app.suites`.
    suites: createSuiteTrpcRouter(mount),
  };
}

/**
 * The operator chain, assembled from the process's own middlewares plus the one
 * gate a declaration cannot describe.
 *
 * Everything but `checkOpsPermission` is the SAME middleware every other
 * procedure on this root carries — the tracer, the logger, the handled-error
 * shaping, the scope-lineage guard, the fail-closed backstop and the audit row
 * — read straight off the mount rather than restated, so the operator surface
 * cannot drift into a chain of its own.
 */
function opsPolicyKit(
  middlewares: TrpcApiMount<never, never, never>["middlewares"],
  opsCheck: AppAgentGroupTrpcPorts["opsCheck"],
): AppTrpcPolicyKit {
  return {
    tracerMiddleware: middlewares.tracer,
    loggerMiddleware: middlewares.logger,
    handledErrorMiddleware: middlewares.handledError,
    enforcePermissionCheck: middlewares.enforceCheck,
    auditLogMutations: middlewares.auditMutations,
    scopeLineageGuard: (declaration) =>
      middlewares.scopeLineageGuard(declaration as AuthzDeclaration),
    checkDeclaredPermission: ({ permission }) =>
      middlewares.declaredCheck({ kind: "permission", permission }),
    declaredNoPermission: ({ reason, allow }) =>
      middlewares.declaredCheck({
        kind: "no-permission",
        reason,
        ...(allow ? { allow: { ...allow } } : {}),
      }),
    checkOpsPermission: opsCheck,
  };
}
