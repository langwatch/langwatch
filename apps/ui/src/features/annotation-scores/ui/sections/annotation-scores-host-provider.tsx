/**
 * What the Annotation Scoring screen and its editor are mounted inside.
 *
 * Two things go around `/settings/annotation-scores`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the project,
 * the lite-member flag, the editor's address and the two notices.
 *
 * THE EDITOR IS AN ADDRESS, not mounted state. `?drawer.open=annotationScoreEditor`
 * with `drawer.annotationScoreId` beside it is what says the overlay is open and
 * on what, which is why a link to a definition being edited is a link somebody
 * else can open — and why the overlay is in the drawer registry rather than
 * rendered by the screen.
 *
 * `isLiteMember` COMES OFF THE ORGANIZATION FACTS, not off a permission: the
 * lite `EXTERNAL` role is a column on the membership, so `hasPermission` cannot
 * answer it. `useUiOrganizationFacts` reads it on this application's transport
 * under the same cache key the settings chrome uses.
 */

import {
  AnnotationScoresHostProvider,
  type AnnotationScoreEditorAddress,
} from "@langwatch/annotation-web/screens/annotation-scores";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import {
  ANNOTATION_SCORE_EDITOR_DRAWER,
  UiAnnotationScoresHost,
} from "../../behavior/annotation-scores-host.adapter";

function AnnotationScoresHost({ children }: { children: ReactNode }) {
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

  const host = useMemo(
    () =>
      UiAnnotationScoresHost.create(
        { project: projectId ? { id: projectId } : void 0, isLiteMember, editor },
        {
          openEditor: (scoreId) =>
            openDrawer(
              ANNOTATION_SCORE_EDITOR_DRAWER,
              scoreId ? { annotationScoreId: scoreId } : {},
            ),
          closeEditor: () => closeDrawer(),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [projectId, isLiteMember, editor, openDrawer, closeDrawer, feedback],
  );

  return <AnnotationScoresHostProvider value={host}>{children}</AnnotationScoresHostProvider>;
}

/** Wraps the Annotation Scoring screen — or its overlay — in the host it asks for. */
export function withAnnotationScoresHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <AnnotationScoresHost>
      <Screen {...props} />
    </AnnotationScoresHost>
  );
  Mounted.displayName = `withAnnotationScoresHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
