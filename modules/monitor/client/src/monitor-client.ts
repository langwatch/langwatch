/** The hooks Monitor's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { monitorTrpc } from "@langwatch/monitor-contract";

type MonitorApiMap = ContractApiMap<typeof monitorTrpc>;

export const monitorClient: ModuleApi<MonitorApiMap> = createModuleApi<MonitorApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type MonitorInputs = { [K in keyof MonitorApiMap]: InputsOf<MonitorApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type MonitorOutputs = OutputsFromMap<MonitorApiMap>;
