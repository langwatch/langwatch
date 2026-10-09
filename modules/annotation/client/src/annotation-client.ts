/** The hooks Annotation's own contract generates, and what each procedure takes and answers. */

import type {
  annotationScoreTrpc,
  annotationTrpc,
  AnnotationFormState,
} from "@langwatch/annotation-contract";
import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import { uiTokens } from "@langwatch/module";

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

/** The annotation form pieces, lent by token to the trace explorer that hosts them (§10.1). */

/** What trace hands annotation's form body in annotate mode. */
export type AnnotateBodyProps = { state: AnnotationFormState };

/** What trace hands annotation form body in suggest mode, diffed against the output it corrects. */
export type SuggestBodyProps = { state: AnnotationFormState; originalOutput: string };

/** What trace hands annotation's form footer: save, delete and cancel over the same state. */
export type AnnotationFormFooterProps = { state: AnnotationFormState; padding: number };

export const AnnotateBodyToken =
  uiTokens("annotation").component<AnnotateBodyProps>("annotateBody");
export const SuggestBodyToken = uiTokens("annotation").component<SuggestBodyProps>("suggestBody");
export const AnnotationFormFooterToken =
  uiTokens("annotation").component<AnnotationFormFooterProps>("annotationFormFooter");
