/**
 * What the score-settings screen and its editor ask of the application.
 *
 * ITS OWN PORT rather than the annotations list's, for the same reason it has
 * its own procedure map: the list's host belongs to the family that moved those
 * four keys, and this page arrived separately. What it asks is narrower — a
 * project, whether the reader is a lite member, the editor's address and two
 * notices — and none of it overlaps with what the list needs that this page
 * does not (the reviewer, the organization, the queue slug).
 *
 * `isLiteMember` is on the port for the reason the datasets family put it on
 * theirs: it is a column on the membership rather than a grant, so
 * `hasPermission` cannot answer it, and the whole write half of this page turns
 * on it.
 */

import { createContext, useContext } from "react";

/** The project every score definition belongs to. */
export type AnnotationScoresProject = {
  id: string;
};

export type AnnotationScoresSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984). `description` is the screen's own copy for a
 * refusal it made itself — an empty option list, a duplicate option — which
 * carries no code at all.
 */
export type AnnotationScoresFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

/** Where the editor is, as an address rather than as mounted state. */
export type AnnotationScoreEditorAddress = {
  /** Whether the editor is open at all. */
  open: boolean;
  /** The definition being edited, or undefined when a new one is being added. */
  scoreId?: string | undefined;
};

export abstract class AnnotationScoresHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): AnnotationScoresProject | undefined;

  /**
   * Whether the reader holds the lite `EXTERNAL` membership role.
   *
   * A lite member reads the score definitions and changes none of them, which
   * is what `useLiteMemberGuard` decided on the platform page.
   */
  abstract isLiteMember(): boolean;

  /** Whether the editor is open, and on what. */
  abstract editor(): AnnotationScoreEditorAddress;

  /** Opens the editor on a definition, or on nothing to add one. */
  abstract openEditor(scoreId?: string): void;

  /** Closes the editor, leaving the page where it is. */
  abstract closeEditor(): void;

  abstract succeeded(notice: AnnotationScoresSuccessNotice): void;

  abstract failed(failure: AnnotationScoresFailureNotice): void;
}

const AnnotationScoresHostContext = createContext<AnnotationScoresHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const AnnotationScoresHostProvider = AnnotationScoresHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useAnnotationScoresHost(): AnnotationScoresHostPort {
  const host = useContext(AnnotationScoresHostContext);
  if (!host) {
    throw new Error(
      "No annotation-scores host is mounted above this screen; render it inside the annotation frontend feature.",
    );
  }
  return host;
}
