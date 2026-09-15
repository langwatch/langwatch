/** What the score-settings UI asks of the application. */

import { createContext, useContext } from "react";

export type AnnotationScoresProject = {
  id: string;
};

export type AnnotationScoresSuccessNotice = {
  title: string;
  description?: string;
};

export type AnnotationScoresFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export type AnnotationScoreEditorAddress = {
  open: boolean;
  scoreId?: string | undefined;
};

export abstract class AnnotationScoresHostApi {
  abstract project(): AnnotationScoresProject | undefined;

  abstract isLiteMember(): boolean;

  abstract editor(): AnnotationScoreEditorAddress;

  abstract openEditor(scoreId?: string): void;

  abstract closeEditor(): void;

  abstract succeeded(notice: AnnotationScoresSuccessNotice): void;

  abstract failed(failure: AnnotationScoresFailureNotice): void;
}

const AnnotationScoresHostContext = createContext<AnnotationScoresHostApi | undefined>(void 0);

export const AnnotationScoresHostProvider = AnnotationScoresHostContext.Provider;

export function useAnnotationScoresHost(): AnnotationScoresHostApi {
  const host = useContext(AnnotationScoresHostContext);

  if (!host) {
    throw new Error(
      "No annotation-scores host is mounted above this screen; render it inside the annotation frontend feature.",
    );
  }

  return host;
}
