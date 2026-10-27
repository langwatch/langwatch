/** The hooks Scenario's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { scenarioTrpc } from "@langwatch/scenario-contract";

type ScenarioApiMap = ContractApiMap<typeof scenarioTrpc>;

export const scenarioClient: ModuleApi<ScenarioApiMap> = createModuleApi<ScenarioApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type ScenarioInputs = { [K in keyof ScenarioApiMap]: InputsOf<ScenarioApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type ScenarioOutputs = OutputsFromMap<ScenarioApiMap>;
