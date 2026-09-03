/**
 * The annotation-scores host port, answered from this application.
 *
 * `@langwatch/annotation-web/screens/annotation-scores` declares what its
 * screen and its overlay need — the project, whether the reader is a lite
 * member, where the editor is, and two notices — as one abstract class it can
 * define without importing anything of ours.
 *
 * NOTHING HERE FETCHES. The values arrive as arguments, so the adapter is a
 * value object a test can construct.
 */

import {
  AnnotationScoresHostPort,
  type AnnotationScoreEditorAddress,
  type AnnotationScoresFailureNotice,
  type AnnotationScoresProject,
  type AnnotationScoresSuccessNotice,
} from "@langwatch/annotation-web/screens/annotation-scores";

/** The grant the platform page asked for, unchanged. */
export const ANNOTATION_SCORES_PAGE_PERMISSION = "annotations:view";

/** The name the editor answers to in the drawer registry, and in the address. */
export const ANNOTATION_SCORE_EDITOR_DRAWER = "annotationScoreEditor";

export type AnnotationScoresHostReadings = {
  project: AnnotationScoresProject | undefined;
  isLiteMember: boolean;
  editor: AnnotationScoreEditorAddress;
};

export type AnnotationScoresHostActions = {
  openEditor: (scoreId?: string) => void;
  closeEditor: () => void;
  succeeded: (notice: AnnotationScoresSuccessNotice) => void;
  failed: (failure: AnnotationScoresFailureNotice) => void;
};

export class UiAnnotationScoresHost extends AnnotationScoresHostPort {
  static create(
    readings: AnnotationScoresHostReadings,
    actions: AnnotationScoresHostActions,
  ): UiAnnotationScoresHost {
    return new UiAnnotationScoresHost(readings, actions);
  }

  private constructor(
    private readonly readings: AnnotationScoresHostReadings,
    private readonly actions: AnnotationScoresHostActions,
  ) {
    super();
  }

  project(): AnnotationScoresProject | undefined {
    return this.readings.project;
  }

  isLiteMember(): boolean {
    return this.readings.isLiteMember;
  }

  editor(): AnnotationScoreEditorAddress {
    return this.readings.editor;
  }

  openEditor(scoreId?: string): void {
    this.actions.openEditor(scoreId);
  }

  closeEditor(): void {
    this.actions.closeEditor();
  }

  succeeded(notice: AnnotationScoresSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AnnotationScoresFailureNotice): void {
    this.actions.failed(failure);
  }
}
