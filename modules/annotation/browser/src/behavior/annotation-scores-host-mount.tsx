/**
 * Annotation Scores' answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useMemo, type ReactNode } from "react";

import {
  AnnotationScoresHostApi,
  AnnotationScoresHostProvider,
  type AnnotationScoreEditorAddress,
  type AnnotationScoresFailureNotice,
  type AnnotationScoresProject,
  type AnnotationScoresSuccessNotice,
} from "../model/annotation-scores-host.ts";

/** The name the editor answers to in the address, unchanged from the monolith. */
const ANNOTATION_SCORE_EDITOR_DRAWER = "annotationScoreEditor";

class CapabilityAnnotationScoresHost extends AnnotationScoresHostApi {
  constructor(
    private readonly deps: {
      projectId: string | undefined;
      isLiteMember: boolean;
      editor: AnnotationScoreEditorAddress;
      openDrawer: (drawer: string, props?: Record<string, unknown>) => void;
      closeDrawer: () => void;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  project(): AnnotationScoresProject | undefined {
    return this.deps.projectId ? { id: this.deps.projectId } : void 0;
  }

  isLiteMember(): boolean {
    return this.deps.isLiteMember;
  }

  editor(): AnnotationScoreEditorAddress {
    return this.deps.editor;
  }

  openEditor(scoreId?: string): void {
    this.deps.openDrawer(
      ANNOTATION_SCORE_EDITOR_DRAWER,
      scoreId ? { annotationScoreId: scoreId } : {},
    );
  }

  closeEditor(): void {
    this.deps.closeDrawer();
  }

  succeeded(notice: AnnotationScoresSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: AnnotationScoresFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AnnotationScoresHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route } = useUiCapabilities();
  const uiScope = useUiScope();
  const { projectId } = uiScope.activeScope();
  const isLiteMember = uiScope.scopeHost()?.organizationRole() === "EXTERNAL";
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
      new CapabilityAnnotationScoresHost({
        projectId: projectId ?? void 0,
        isLiteMember,
        editor,
        openDrawer,
        closeDrawer,
        feedback,
      }),
    [projectId, isLiteMember, editor, openDrawer, closeDrawer, feedback],
  );

  return <AnnotationScoresHostProvider value={host}>{children}</AnnotationScoresHostProvider>;
}
