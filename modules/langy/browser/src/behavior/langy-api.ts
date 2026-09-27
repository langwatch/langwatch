/**
 * The procedures the Langy dock calls, derived from their owners' contracts.
 */

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type { dashboardTrpc, dashboardWidgetTrpc, graphTrpc } from "@langwatch/dashboard-contract";
import type { datasetTrpc } from "@langwatch/dataset-contract";
import type { experimentsTrpc } from "@langwatch/experiment-contract";
import type { githubTrpc } from "@langwatch/github-contract";
import type { langyTrpc } from "@langwatch/langy-contract";
import type { modelProviderTrpc } from "@langwatch/model-provider-contract";
import type { integrationsChecksTrpc } from "@langwatch/onboarding-contract";
import type { organizationTrpc } from "@langwatch/organization-contract";
import type { promptTrpc } from "@langwatch/prompt-contract";
import type { secretTrpc } from "@langwatch/secret-contract";
import type { tracesTrpc } from "@langwatch/trace-contract";
import type { userTrpc } from "@langwatch/user-contract";

export type LangyApiMap = ContractApiMap<typeof langyTrpc> &
  ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof tracesTrpc> &
  ContractApiMap<typeof organizationTrpc> &
  ContractApiMap<typeof dashboardTrpc> &
  ContractApiMap<typeof dashboardWidgetTrpc> &
  ContractApiMap<typeof graphTrpc> &
  ContractApiMap<typeof integrationsChecksTrpc> &
  ContractApiMap<typeof githubTrpc> &
  ContractApiMap<typeof datasetTrpc> &
  ContractApiMap<typeof promptTrpc> &
  ContractApiMap<typeof experimentsTrpc> &
  ContractApiMap<typeof secretTrpc> &
  ContractApiMap<typeof userTrpc>;

/** What each procedure in the map answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<LangyApiMap>;

export const api = createModuleApi<LangyApiMap>();

/** The same object, under the name the process shell mounts it by. */
export const langyApi = api;

/** The typed imperative client the api's provider carries, for code that runs outside a hook. */
export type LangyTrpcClient = ReturnType<typeof api.useUtils>["client"];

/**
 * One turn-stream entry as the browser receives it: the contract's entry after the wire's
 * serialisation, which loosens card payloads the stream carries but never reads.
 */
export type LangyStreamWireEntry = RouterOutputs["langy"]["onTurnStream"];
