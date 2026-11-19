import { useMemo } from "react";
import type { IconType } from "react-icons";
import { LuLanguages, LuLightbulb, LuMessageSquare, LuPlay } from "react-icons/lu";

import { useSpanPlaygroundHref } from "../../../../behavior/prompts/use-span-playground-href.ts";
import { useTraceHost } from "../../../../behavior/trace-host.ts";
import {
  type TraceAnchor,
  useAnchoredAnnotations,
} from "../../../../features/annotation/behavior/use-anchored-annotations.ts";
import type { useTextTranslation } from "../../../../features/trace-drawer/behavior/use-text-translation.ts";
import { BRAIDED_ACTION_DISABLED_REASON } from "../../../../model/braids/braided-span.ts";
import { FieldCommentButton } from "./anchored-comments/field-comment-button.tsx";
import {
  PlaygroundButton,
  SuggestCorrectionButton,
  TranslateButton,
  UnavailableActionButton,
} from "./io-toolbar-buttons.tsx";

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
 */
function buildIOActions({
  translation,
  traceId,
  fieldAnchor,
  originalContent,
  showComment,
  showSuggest,
  playgroundHref,
  isBraided,
}: {
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  fieldAnchor: TraceAnchor | null;
  originalContent: string;
  showComment: boolean;
  showSuggest: boolean;
  playgroundHref: string;
  isBraided: boolean;
}): IOAction[] {
  const settledTranslationLabel = translation.isActive ? "Show original" : "Translate";
  const translationLabel = translation.isLoading ? "Translating…" : settledTranslationLabel;

  const actions: IOAction[] = [
    {
      id: "translate",
      menuLabel: translationLabel,
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

  if (isBraided) {
    return [
      ...actions,
      ...unavailableOnBraidedSpan({
        comment: !!traceId && !!fieldAnchor && showComment,
        suggest: !!traceId && !!fieldAnchor && showSuggest,
        playground: !!playgroundHref,
      }),
    ];
  }

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
        <SuggestCorrectionButton traceId={traceId} output={originalContent} anchor={fieldAnchor} />
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

/** A braided span is another project's data: each action an own span would offer is off. */
function unavailableOnBraidedSpan(offered: {
  comment: boolean;
  suggest: boolean;
  playground: boolean;
}): IOAction[] {
  const unavailable = [
    { id: "comment", label: "Comment", icon: LuMessageSquare },
    { id: "suggest", label: "Suggest edit", icon: LuLightbulb },
    { id: "playground", label: "Open in Playground", icon: LuPlay },
  ] as const;
  return unavailable
    .filter(({ id }) => offered[id])
    .map(({ id, label, icon }) => ({
      id,
      menuLabel: label,
      menuIcon: icon,
      disabled: true,
      render: () => (
        <UnavailableActionButton
          icon={icon}
          label={label}
          reason={BRAIDED_ACTION_DISABLED_REASON}
        />
      ),
    }));
}

/**
 * Which annotation actions this reader gets, and where "Open in Playground" points.
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
  const traceHost = useTraceHost();
  const annotations = useAnchoredAnnotations();
  const playgroundHrefFor = useSpanPlaygroundHref();

  const canAnnotate = traceHost.hasPermission("annotations:manage");
  return {
    showComment:
      fieldAnchor !== null && (canAnnotate || annotations.commentsAt(fieldAnchor).length > 0),
    showSuggest: fieldAnchor !== null && canAnnotate,
    // No explicit playground action — the loader auto-detects: opens the
    // existing managed prompt at the traced version when one is linked,
    // creates a fresh tab when not. One button, smart default.
    playgroundHref:
      spanType === "llm" && spanId && mode === "input" ? playgroundHrefFor(spanId) : "",
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
  isBraided = false,
}: {
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  spanId: string | undefined;
  spanType: string | undefined;
  mode: "input" | "output";
  fieldAnchor: TraceAnchor | null;
  originalContent: string;
  /** A span braided in from another project, whose data this reader may not act on. */
  isBraided?: boolean;
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
        isBraided,
      }),
    [
      translation,
      traceId,
      fieldAnchor,
      originalContent,
      showComment,
      showSuggest,
      playgroundHref,
      isBraided,
    ],
  );
}
