/** What annotation lends this module by token (ARCHITECTURE.md §10, §10.1). */

import {
  AnnotateBodyToken,
  AnnotationFormFooterToken,
  SuggestBodyToken,
  type AnnotateBodyProps,
  type AnnotationFormFooterProps,
  type SuggestBodyProps,
} from "@langwatch/annotation-contract";
import { Lent } from "@langwatch/browser-host/lent";

/** Annotation's comment-and-scores body, rendered as annotation lends it. */
export function AnnotateBody(props: AnnotateBodyProps) {
  return <Lent of={AnnotateBodyToken} props={props} />;
}

/** Annotation's suggested-output body, rendered as annotation lends it. */
export function SuggestBody(props: SuggestBodyProps) {
  return <Lent of={SuggestBodyToken} props={props} />;
}

/** Annotation's form footer, rendered as annotation lends it. */
export function FormFooter(props: AnnotationFormFooterProps) {
  return <Lent of={AnnotationFormFooterToken} props={props} />;
}
