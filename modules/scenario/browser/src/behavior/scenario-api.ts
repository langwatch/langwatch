/**
 * The procedures this family calls, derived from their owners' contracts, and the hooks that
 * call them.
 */

import type { agentTrpc, httpProxyTrpc } from "@langwatch/agent-contract";
import { type ContractApiMap, createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";
import type { featureFlagTrpc } from "@langwatch/feature-flag-contract";
import type { modelProviderTrpc } from "@langwatch/model-provider-contract";
import type { opsDashboardTrpc } from "@langwatch/ops-contract";
import type {
  OrganizationWithMembersAndTheirTeams,
  organizationTrpc,
} from "@langwatch/organization-contract";
import type { promptTrpc } from "@langwatch/prompt-contract";
import type { scenarioTrpc } from "@langwatch/scenario-contract";
import type { suiteTrpc, testSuiteTrpc } from "@langwatch/suite-contract";
import type { exportTrpc, tracesTrpc } from "@langwatch/trace-contract";
import type { workflowTrpc } from "@langwatch/workflow-contract";

/** authz states this procedure in its process transport, not its contract, so it is typed here. */
type AuthzProcedures = {
  authz: {
    effectivePermissions: {
      query: {
        input: { projectId?: string; organizationId?: string };
        output: { permissions: string[] };
      };
    };
  };
};

/**
 * The organization aggregate is declared `unknown` on its contract; the browser reads it as the
 * contract's own `OrganizationWithMembersAndTheirTeams`.
 */
type OrganizationMembersProcedure = {
  organization: {
    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: OrganizationWithMembersAndTheirTeams;
      };
    };
  };
};

export type ScenarioApiMap = ContractApiMap<typeof scenarioTrpc> &
  ContractApiMap<typeof suiteTrpc> &
  ContractApiMap<typeof testSuiteTrpc> &
  ContractApiMap<typeof agentTrpc> &
  ContractApiMap<typeof httpProxyTrpc> &
  ContractApiMap<typeof featureFlagTrpc> &
  ContractApiMap<typeof exportTrpc> &
  ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof organizationTrpc> &
  ContractApiMap<typeof promptTrpc> &
  ContractApiMap<typeof tracesTrpc> &
  ContractApiMap<typeof workflowTrpc> &
  ContractApiMap<typeof evaluatorTrpc> &
  ContractApiMap<typeof opsDashboardTrpc> &
  AuthzProcedures &
  OrganizationMembersProcedure;

/** What each procedure in the map takes, as the browser sends it. */
export type RouterInputs = { [K in keyof ScenarioApiMap]: InputsOf<ScenarioApiMap[K]> };

/** What each procedure in the map answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<ScenarioApiMap>;

/** A scenario as the browser receives it: dates arrive as ISO strings. */
export type Scenario = NonNullable<RouterOutputs["scenarios"]["getById"]>;

/** A run plan or test suite as the browser receives it. */
export type SimulationSuite = NonNullable<RouterOutputs["suites"]["getById"]>;

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

export const api = createModuleApi<ScenarioApiMap>();

/** The same object, under the name the process shell mounts it by. */
export const scenarioApi = api;
