import { Button, Icon, type SystemStyleObject, Text } from "@chakra-ui/react";
import { forwardRef, useState } from "react";
import { LuMessageSquare } from "react-icons/lu";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { Popover } from "@langwatch/design-system/popover";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceAnchor } from "../../../hooks/useAnchoredAnnotations";
import { AnnotationPopover } from "../conversationView/AnnotationPopover";
import { AnchorCommentThread } from "./AnchorCommentThread";

/**
 * Whether a control with no room for a label is on screen right now.
 *
 * - `always`: the surface has room for it at rest.
 * - `hidden`: revealed by the row it sits on, which tracks its own hover.
 * - `on-row-hover`: revealed by the attribute row around it, the way the copy
 *   action beside it already behaves. A glyph on every row at rest would make
 *   a dense table noisier to read, which is the one thing that table is for.
 * - `on-block-hover`: revealed by the message block around it, for the same
 *   reason: a transcript is prose, and a glyph beside every paragraph of it
 *   competes with the words.
 */
export type AnchorCommentReveal = "always" | "hidden" | "on-row-hover" | "on-block-hover";

interface AnchorCommentButtonProps {
  traceId: string;
  /** The part of the trace a comment left here is about. */
  anchor: TraceAnchor;
  /** What was already said about that part. */
  comments: AnnotationByTrace[];
  /**
   * The row this acts on, named in the accessible label. Required on a dense
   * control, where the label is the only thing telling one row's comment
   * action from the next one's.
   */
  name?: string;
  /** True on a row with no room for a visible label. */
  dense?: boolean;
  /** Only read on a dense control; a labelled one is always on screen. */
  reveal?: AnchorCommentReveal;
}

/**
 * The comment affordance for one part of a trace: how many comments it carries,
 * and the way to read them and add another.
 *
 * Carries its label in words wherever there is room. On the waterfall row and
 * the attribute row there is none, so it names the row it acts on instead, the
 * way those rows' delete and pin actions already do.
 *
 * A reader who may not write annotations is offered no way in, but still reads
 * what is there: the count opens the thread with no composer under it.
 */
export function AnchorCommentButton({
  traceId,
  anchor,
  comments,
  name,
  dense = false,
  reveal = "always",
}: AnchorCommentButtonProps) {
  const { hasPermission } = useOrganizationTeamProject();
  const [open, setOpen] = useState(false);
  const annotationsGate = usePersonalFeatureGate("annotations");
  const canManage = hasPermission("annotations:manage");

  if (!canManage && comments.length === 0) return null;

  // A count is the reason the control is there, so it never hides behind a
  // hover: a comment nobody can see is a comment nobody reads.
  const shown: AnchorCommentReveal = comments.length > 0 ? "always" : reveal;
  const denseLabel = denseCommentLabel({ count: comments.length, name });
  const trigger = dense ? (
    <DenseTrigger count={comments.length} label={denseLabel} reveal={shown} />
  ) : (
    <LabelledTrigger count={comments.length} />
  );

  if (!canManage) {
    return (
      <Popover.Root
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        lazyMount
        unmountOnExit
        positioning={{ placement: "bottom-end", flip: true, shift: 16 }}
      >
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
        <Popover.Content
          width="380px"
          onClick={(e) => e.stopPropagation()}
          bg="bg.panel/92"
        >
          <Popover.Arrow />
          <Popover.Body padding={3}>
            <AnchorCommentThread comments={comments} />
          </Popover.Body>
        </Popover.Content>
      </Popover.Root>
    );
  }

  return (
    <>
      <AnnotationPopover
        traceId={traceId}
        mode="annotate"
        anchorKind={anchor.anchorKind}
        anchorId={anchor.anchorId}
        anchorPath={anchor.anchorPath}
        open={open}
        onOpenChange={async (next) => {
          if (next) {
            const allowed = await annotationsGate.requestEnable();
            if (!allowed) return;
          }
          setOpen(next);
        }}
        thread={<AnchorCommentThread comments={comments} />}
        triggerTooltip={dense ? denseLabel : undefined}
        trigger={trigger}
      />
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
    </>
  );
}

/** What the control says when there is room to say it. */
function commentCountLabel(count: number): string {
  if (count === 0) return "Comment";
  return count === 1 ? "1 comment" : `${count} comments`;
}

/** What the control is called when there is no room to write it down. */
function denseCommentLabel({ count, name }: { count: number; name?: string }): string {
  const on = name ? ` on ${name}` : "";
  if (count === 0) return `Comment${on}`;
  return count === 1 ? `1 comment${on}` : `${count} comments${on}`;
}

/**
 * The labelled control, matching the actions beside it on a panel header. The
 * visible text is the accessible name, so it carries no `aria-label`.
 */
const LabelledTrigger = forwardRef<
  HTMLButtonElement,
  { count: number } & React.ComponentProps<typeof Button>
>(function LabelledTrigger({ count, onClick, ...triggerProps }, ref) {
  return (
    <Button
      ref={ref}
      size="xs"
      variant="ghost"
      color={count > 0 ? "purple.fg" : "fg.muted"}
      gap={1.5}
      paddingX={2}
      height="22px"
      data-testid="anchor-comment-button"
      {...triggerProps}
      // The surfaces this sits on click through to something else — a span
      // row, a collapsing panel header — so the gesture stops here and then
      // opens the popover the trigger wired up.
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <Icon as={LuMessageSquare} boxSize={3} />
      {commentCountLabel(count)}
    </Button>
  );
});

/**
 * Which surface's hover brings the control back, for the modes that leave it to
 * CSS. `always` and `hidden` are decided in JavaScript and need no rule.
 */
const REVEAL_ON_HOVER_CSS: Record<AnchorCommentReveal, SystemStyleObject | undefined> = {
  always: undefined,
  hidden: undefined,
  "on-row-hover": { ".attr-row:hover &": { opacity: 1 } },
  "on-block-hover": { ".msg-block:hover &": { opacity: 1 } },
};

/**
 * The control on a row too dense for a label. The count rides beside the glyph
 * so a commented row reads as commented while scanning, and the accessible name
 * says which row it acts on.
 */
const DenseTrigger = forwardRef<
  HTMLButtonElement,
  {
    count: number;
    label: string;
    reveal: AnchorCommentReveal;
  } & React.ComponentProps<typeof Button>
>(function DenseTrigger({ count, label, reveal, onClick, ...triggerProps }, ref) {
  // Both reveal modes keep the control off screen until its row is under the
  // cursor, and they get there differently. The waterfall row tracks its own
  // hover in a store, so the control can be taken out of the tab order while it
  // is invisible and put back when the row reveals it. The attribute row leaves
  // it to CSS, which nothing can read back, so that one stays reachable the way
  // the copy action beside it already is.
  const isSuppressed = reveal === "hidden";
  const isFaded = reveal !== "always";
  return (
    <Button
      ref={ref}
      size="xs"
      variant="ghost"
      aria-label={label}
      data-testid="anchor-comment-button"
      padding={0}
      minWidth="auto"
      width={count > 0 ? "auto" : "20px"}
      paddingX={count > 0 ? 1 : 0}
      height="20px"
      gap={0.5}
      flexShrink={0}
      marginLeft={1}
      borderRadius="xs"
      color={count > 0 ? "purple.fg" : "fg.subtle"}
      bg={count > 0 ? "purple.subtle" : undefined}
      opacity={isFaded ? 0 : 1}
      pointerEvents={isSuppressed ? "none" : "auto"}
      tabIndex={isSuppressed ? -1 : 0}
      aria-hidden={isSuppressed}
      transition="opacity 0.1s ease"
      _hover={{
        bg: count > 0 ? "purple.subtle" : "bg.emphasized",
        opacity: 1,
      }}
      _focusVisible={{ opacity: 1, bg: "bg.emphasized" }}
      css={REVEAL_ON_HOVER_CSS[reveal]}
      {...triggerProps}
      // The row underneath selects a span when it is clicked, so the gesture
      // stops here and then opens the popover the trigger wired up.
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      <Icon as={LuMessageSquare} boxSize={3} />
      {count > 0 && (
        <Text textStyle="2xs" fontWeight="semibold" lineHeight={1}>
          {count}
        </Text>
      )}
    </Button>
  );
});
