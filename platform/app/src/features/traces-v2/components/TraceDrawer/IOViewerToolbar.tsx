import { Box, Button, Flex, HStack, Icon } from "@chakra-ui/react";
import { forwardRef, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuCheck,
  LuCode,
  LuCopy,
  LuEye,
  LuLanguages,
  LuLightbulb,
  LuList,
  LuMessageSquare,
  LuPlay,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground";
import {
  type TraceAnchor,
  useAnchoredAnnotations,
} from "../../hooks/useAnchoredAnnotations";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useOverflowVisibility } from "../../hooks/useOverflowVisibility";
import type { useTextTranslation } from "../../hooks/useTextTranslation";
import { OverflowMenu } from "../shared/OverflowMenu";
import { FieldCommentButton } from "./anchoredComments/FieldCommentButton";
import { AnnotationPopover } from "./conversationView/AnnotationPopover";
import { FormatSelect } from "./FormatSelect";
import type { ChatLayout } from "./transcript";
import type { ViewFormat } from "./useIOViewerState";

/**
 * Room held back on the right edge of the actions row for the overflow
 * trigger, which lives inside the measured row. Matches the reserve the
 * viz tab strip uses for the same trigger.
 */
const OVERFLOW_TRIGGER_RESERVE_PX = 26;

const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: IconType;
    label: string;
  } & React.ComponentProps<typeof Button>
>(function ActionButton({ icon, label, ...buttonProps }, ref) {
  return (
    <Button
      ref={ref}
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
      onClick={(e) => e.stopPropagation()}
      {...buttonProps}
    >
      <Icon as={icon} boxSize={3} />
      {label}
    </Button>
  );
});

function PlaygroundButton({ href }: { href: string }) {
  return (
    <Button
      asChild
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon as={LuPlay} boxSize={3} />
        Open in Playground
      </a>
    </Button>
  );
}

function SuggestCorrectionButton({
  traceId,
  output,
  anchor,
}: {
  traceId: string;
  output: string;
  /** The field the suggestion corrects. */
  anchor: TraceAnchor;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode="suggest"
      anchorKind={anchor.anchorKind}
      anchorId={anchor.anchorId}
      anchorPath={anchor.anchorPath}
      open={open}
      onOpenChange={setOpen}
      trigger={<ActionButton icon={LuLightbulb} label="Suggest edit" />}
    />
  );
}

function TranslateButton({
  isActive,
  isLoading,
  onToggle,
}: {
  isActive: boolean;
  isLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <ActionButton
      icon={LuLanguages}
      label={
        isLoading ? "Translating…" : isActive ? "Show original" : "Translate"
      }
      aria-pressed={isActive}
      color={isActive ? "blue.fg" : "fg.muted"}
      disabled={isLoading}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copy(text);
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      padding={0}
      minWidth="auto"
      height="auto"
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
    </Button>
  );
}

/** One toolbar action: its inline rendering and its overflow-menu row. */
type IOAction = {
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
      render: () => (
        <FieldCommentButton traceId={traceId} anchor={fieldAnchor} />
      ),
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
 * The format options for a panel, with the inline submode toggles the
 * active format carries.
 *
 * Both chat layouts (thread / bubbles) are available for any chat-shaped
 * content — input *or* output. Even with a single assistant reply, the
 * operator may want the bubble visual; conversely, a multi-message output
 * (rare but possible) benefits from the flat stack.
 */
function formatSelectOptions({
  formatOptions,
  isChat,
  chatLayout,
  onChatLayoutChange,
  markdownSubmode,
  onMarkdownSubmodeChange,
}: {
  formatOptions: readonly ViewFormat[];
  isChat: boolean;
  chatLayout: ChatLayout;
  onChatLayoutChange: (layout: ChatLayout) => void;
  markdownSubmode: "rendered" | "source";
  onMarkdownSubmodeChange: (submode: "rendered" | "source") => void;
}) {
  return formatOptions.map((option) => {
    if (option === "pretty" && isChat) {
      return {
        value: option,
        submodes: {
          value: chatLayout,
          onChange: onChatLayoutChange,
          options: [
            {
              value: "thread",
              label: "Thread",
              icon: LuList,
              tooltip: "Thread layout",
            },
            {
              value: "bubbles",
              label: "Bubbles",
              icon: LuMessageSquare,
              tooltip: "Bubble layout",
            },
          ],
        },
      };
    }
    if (option === "markdown") {
      return {
        value: option,
        submodes: {
          value: markdownSubmode,
          onChange: onMarkdownSubmodeChange,
          options: [
            {
              value: "rendered",
              label: "Rendered",
              icon: LuEye,
              tooltip: "Rendered markdown view",
            },
            {
              value: "source",
              label: "Source",
              icon: LuCode,
              tooltip: "Source markdown view",
            },
          ],
        },
      };
    }
    return { value: option };
  });
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
 * One action in the row. Collapsed, it keeps its real control mounted at zero
 * width: the overflow menu selects it by clicking that control, so popover
 * wiring and permission gates live in one place.
 */
function IOActionSlot({
  action,
  hidden,
  elementRef,
}: {
  action: IOAction;
  hidden: boolean;
  elementRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <Flex
      data-overflow-id={action.id}
      ref={elementRef}
      align="center"
      flexShrink={0}
      paddingLeft={2}
      {...(hidden
        ? {
            width: 0,
            minWidth: 0,
            paddingLeft: 0,
            overflow: "hidden",
            visibility: "hidden",
          }
        : {})}
    >
      {action.render()}
    </Flex>
  );
}

/**
 * The measured part of the toolbar: the actions, right-aligned, and the
 * three-dot menu holding whichever of them no longer fit.
 */
function IOActionsRow({
  actions,
  collapsed,
}: {
  actions: readonly IOAction[];
  collapsed: boolean;
}) {
  // Stable by VALUE, not reference: `actions` rebuilds on unrelated renders
  // (translation state identity churns), and `useOverflowVisibility` resets
  // its measurement whenever the items array changes reference — an unstable
  // array here loops reset → render → reset forever.
  const actionIdsKey = actions.map((a) => a.id).join(" ");
  const actionIds = useMemo(() => actionIdsKey.split(" "), [actionIdsKey]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const actionElsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const hiddenActionIds = useOverflowVisibility({
    scrollerRef,
    items: actionIds,
    reservePx: OVERFLOW_TRIGGER_RESERVE_PX,
  });

  return (
    // Stays mounted while the panel is collapsed so its ResizeObserver keeps
    // watching the same element — going through display:none and back
    // re-measures on its own.
    <HStack
      ref={scrollerRef}
      display={collapsed ? "none" : "flex"}
      flex={1}
      minWidth={0}
      gap={0}
      overflow="hidden"
      flexWrap="nowrap"
      align="center"
    >
      <Box flex={1} minWidth={0} />
      {actions.map((action) => (
        <IOActionSlot
          key={action.id}
          action={action}
          hidden={hiddenActionIds.has(action.id)}
          elementRef={(el) => {
            actionElsRef.current[action.id] = el;
          }}
        />
      ))}
      {/* Inside the measured row, in the slot `reservePx` holds back for it.
          As an outside sibling its mount would shrink the row, the
          ResizeObserver would clear the hidden set, and the trigger would
          unmount and remount on every measurement. */}
      <OverflowMenu
        items={actions
          .filter((action) => hiddenActionIds.has(action.id))
          .map((action) => ({
            id: action.id,
            label: action.menuLabel,
            icon: <Icon as={action.menuIcon} boxSize={3.5} />,
            disabled: action.disabled,
          }))}
        onSelect={(id) => {
          actionElsRef.current[id]
            ?.querySelector<HTMLElement>("button, a")
            ?.click();
        }}
        ariaLabel="More actions"
      />
    </HStack>
  );
}

interface IOViewerToolbarProps {
  /** Names the panel in the format selector's accessible name. */
  label: string;
  /** While collapsed only the format selector and Copy are useful. */
  collapsed: boolean;
  format: ViewFormat;
  onFormatChange: (format: ViewFormat) => void;
  formatOptions: readonly ViewFormat[];
  isChat: boolean;
  chatLayout: ChatLayout;
  onChatLayoutChange: (layout: ChatLayout) => void;
  markdownSubmode: "rendered" | "source";
  onMarkdownSubmodeChange: (submode: "rendered" | "source") => void;
  translation: ReturnType<typeof useTextTranslation>;
  traceId: string | undefined;
  spanId: string | undefined;
  spanType: string | undefined;
  mode: "input" | "output";
  /** Which part of the trace an annotation on this panel is about. */
  fieldAnchor: TraceAnchor | null;
  /** The untranslated text, which is what a correction must replace. */
  originalContent: string;
  /** What Copy puts on the clipboard: whatever the panel displays. */
  copyText: string;
}

/**
 * The controls row of an INPUT / OUTPUT panel: one compact format selector,
 * the actions that operate on the field, and Copy.
 *
 * The row keeps one footprint no matter how many actions a panel offers.
 * Actions that no longer fit collapse into the three-dot overflow menu, the
 * same element the span tab strip uses, and Copy stays outside that menu as
 * the last control in the row.
 */
export function IOViewerToolbar({
  label,
  collapsed,
  format,
  onFormatChange,
  formatOptions,
  isChat,
  chatLayout,
  onChatLayoutChange,
  markdownSubmode,
  onMarkdownSubmodeChange,
  translation,
  traceId,
  spanId,
  spanType,
  mode,
  fieldAnchor,
  originalContent,
  copyText,
}: IOViewerToolbarProps) {
  const { showComment, showSuggest, playgroundHref } = useIOActionGates({
    fieldAnchor,
    spanId,
    spanType,
    mode,
  });

  const actions = useMemo(
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

  return (
    <>
      {!collapsed && (
        <FormatSelect
          value={format}
          onChange={onFormatChange}
          ariaLabel={`${label} view format`}
          options={formatSelectOptions({
            formatOptions,
            isChat,
            chatLayout,
            onChatLayoutChange,
            markdownSubmode,
            onMarkdownSubmodeChange,
          })}
        />
      )}
      <IOActionsRow actions={actions} collapsed={collapsed} />
      <CopyButton text={copyText} />
    </>
  );
}
