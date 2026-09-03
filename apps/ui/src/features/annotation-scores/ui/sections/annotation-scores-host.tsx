/**
 * What the Annotation Scoring screen and its editor mount inside. The editor
 * is an address, not mounted state, so a link to it is shareable.
 * `isLiteMember` comes off the organization facts, not a permission.
 */

import {
  AnnotationScoresHostProvider,
  type AnnotationScoreEditorAddress,
  type AnnotationScoresHostPort,
} from "@langwatch/annotation-web/screens/annotation-scores";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";

/** The name the editor answers to in the drawer registry, and in the address. */
export const ANNOTATION_SCORE_EDITOR_DRAWER = "annotationScoreEditor";

export function AnnotationScoresHost({ children }: { children: ReactNode }) {
  const { session, feedback, route } = useUiCapabilities();
  const { projectId } = session.activeScope();
  const { isLiteMember } = useUiOrganizationFacts();
  const { openDrawer, closeDrawer } = useDrawer();

  const query = route.reading().query;
  const editor: AnnotationScoreEditorAddress = useMemo(
    () => ({
      open: query["drawer.open"] === ANNOTATION_SCORE_EDITOR_DRAWER,
      scoreId: query["drawer.annotationScoreId"],
    }),
    [query],
  );

  const host = useMemo<AnnotationScoresHostPort>(
    () => ({
      project: () => (projectId ? { id: projectId } : void 0),
      isLiteMember: () => isLiteMember,
      editor: () => editor,
      openEditor: (scoreId) =>
        openDrawer(ANNOTATION_SCORE_EDITOR_DRAWER, scoreId ? { annotationScoreId: scoreId } : {}),
      closeEditor: () => closeDrawer(),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [projectId, isLiteMember, editor, openDrawer, closeDrawer, feedback],
  );

  return <AnnotationScoresHostProvider value={host}>{children}</AnnotationScoresHostProvider>;
}
