/** The hooks Annotation's own contract generates, and what each procedure takes and answers. */

import type { annotationScoreTrpc, annotationTrpc } from "@langwatch/annotation-contract";
import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";

type AnnotationApiMap = ContractApiMap<typeof annotationScoreTrpc> &
  ContractApiMap<typeof annotationTrpc>;

export const annotationClient: ModuleApi<AnnotationApiMap> = createModuleApi<AnnotationApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type AnnotationInputs = { [K in keyof AnnotationApiMap]: InputsOf<AnnotationApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type AnnotationOutputs = OutputsFromMap<AnnotationApiMap>;
