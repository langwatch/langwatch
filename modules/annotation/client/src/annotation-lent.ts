/** The annotation form pieces, lent by token to the trace explorer that hosts them (§10.1). */

import type { AnnotationFormState } from "@langwatch/annotation-contract";
import { uiTokens } from "@langwatch/module";

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
