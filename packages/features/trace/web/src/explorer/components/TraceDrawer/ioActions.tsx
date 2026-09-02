import { useMemo } from "react";
import type { IconType } from "react-icons";
import { LuLanguages, LuLightbulb, LuMessageSquare, LuPlay } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "../../../prompts/useLoadSpanIntoPromptPlayground";
import {
  type TraceAnchor,
  useAnchoredAnnotations,
} from "../../hooks/useAnchoredAnnotations";
import type { useTextTranslation } from "../../hooks/useTextTranslation";
import { FieldCommentButton } from "./anchoredComments/FieldCommentButton";
import {
  PlaygroundButton,
  SuggestCorrectionButton,
  TranslateButton,
} from "./IOToolbarButtons";

/** One toolbar action: its inline rendering and its overflow-menu row. */
export type IOAction = {
  id: string;
  menuLabel: string;
  menuIcon: IconType;
  disabled?: boolean;
  render: () => React.ReactNode;
};

/**
 * The toolbar actions a panel offers, in render order.
 *
 * Each action keeps its real component mounted even while collapsed, so
 * popover wiring and permission gates live in one place and picking the
 * action out of the overflow menu clicks the same control.
 */
function buildIOActions({
  translation,
  traceId,
  fieldAnchor,
  originalContent,
  showComment,
  showSuggest,
  playgroundHref,
}: {
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  fieldAnchor: TraceAnchor | null;
  originalContent: string;
  showComment: boolean;
  showSuggest: boolean;
  playgroundHref: string;
}): IOAction[] {
  const actions: IOAction[] = [
    {
      id: "translate",
      menuLabel: translation.isLoading
        ? "Translating…"
        : translation.isActive
          ? "Show original"
          : "Translate",
      menuIcon: LuLanguages,
      disabled: translation.isLoading,
      render: () => (
        <TranslateButton
          isActive={translation.isActive}
          isLoading={translation.isLoading}
          onToggle={translation.toggle}
        />
      ),
    },
  ];

  if (traceId && fieldAnchor && showComment) {
    actions.push({
      id: "comment",
      menuLabel: "Comment",
      menuIcon: LuMessageSquare,
      render: () => <FieldCommentButton traceId={traceId} anchor={fieldAnchor} />,
    });
  }

  if (traceId && fieldAnchor && showSuggest) {
    actions.push({
      id: "suggest",
      menuLabel: "Suggest edit",
      menuIcon: LuLightbulb,
      // Every field this viewer shows is one a correction can replace, the
      // trace's own input included. Corrections must be stored against the
      // REAL text, never the translated variant the viewer happens to show.
      render: () => (
        <SuggestCorrectionButton
          traceId={traceId}
          output={originalContent}
          anchor={fieldAnchor}
        />
      ),
    });
  }

  if (playgroundHref) {
    actions.push({
      id: "playground",
      menuLabel: "Open in Playground",
      menuIcon: LuPlay,
      render: () => <PlaygroundButton href={playgroundHref} />,
    });
  }

  return actions;
}

/**
 * Which annotation actions this reader gets, and where "Open in Playground"
 * points.
 *
 * The annotation gate mirrors AnchorCommentButton's own: writers always get
 * the action, readers only when there is something to read.
 */
function useIOActionGates({
  fieldAnchor,
  spanId,
  spanType,
  mode,
}: {
  fieldAnchor: TraceAnchor | null;
  spanId: string | undefined;
  spanType: string | undefined;
  mode: "input" | "output";
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const annotations = useAnchoredAnnotations();
  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();

  const canAnnotate = hasPermission("annotations:manage");
  return {
    showComment:
      fieldAnchor !== null &&
      (canAnnotate || annotations.commentsAt(fieldAnchor).length > 0),
    showSuggest: fieldAnchor !== null && canAnnotate,
    // No explicit playground action — the loader auto-detects: opens the
    // existing managed prompt at the traced version when one is linked,
    // creates a fresh tab when not. One button, smart default.
    playgroundHref:
      spanType === "llm" && spanId && mode === "input"
        ? (buildUrl(spanId)?.toString() ?? "")
        : "",
  };
}

/**
 * The panel's actions, with the annotation gates and the playground target
 * already applied.
 */
export function useIOActions({
  translation,
  traceId,
  spanId,
  spanType,
  mode,
  fieldAnchor,
  originalContent,
}: {
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  spanId: string | undefined;
  spanType: string | undefined;
  mode: "input" | "output";
  fieldAnchor: TraceAnchor | null;
  originalContent: string;
}): IOAction[] {
  const { showComment, showSuggest, playgroundHref } = useIOActionGates({
    fieldAnchor,
    spanId,
    spanType,
    mode,
  });

  return useMemo(
    () =>
      buildIOActions({
        translation,
        traceId,
        fieldAnchor,
        originalContent,
        showComment,
        showSuggest,
        playgroundHref,
      }),
    [
      translation,
      traceId,
      fieldAnchor,
      originalContent,
      showComment,
      showSuggest,
      playgroundHref,
    ],
  );
}
