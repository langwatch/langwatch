/** The hooks Dataset's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { batchRecordTrpc, datasetRecordTrpc, datasetTrpc } from "@langwatch/dataset-contract";

type DatasetApiMap = ContractApiMap<typeof batchRecordTrpc> &
  ContractApiMap<typeof datasetRecordTrpc> &
  ContractApiMap<typeof datasetTrpc>;

export const datasetClient: ModuleApi<DatasetApiMap> = createModuleApi<DatasetApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type DatasetInputs = { [K in keyof DatasetApiMap]: InputsOf<DatasetApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type DatasetOutputs = OutputsFromMap<DatasetApiMap>;
