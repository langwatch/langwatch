import {
  AnnotateBody,
  FormFooter,
  SuggestBody,
  type PopoverAnnotationFormInput,
} from "@langwatch/annotation-web";
import { Popover } from "~/components/ui/popover";
import { TriggerAnchor } from "~/components/ui/TriggerAnchor";
import { Tooltip } from "~/components/ui/tooltip";
import { usePopoverAnnotationForm } from "./useAnnotationForm";

interface AnnotationPopoverProps extends PopoverAnnotationFormInput {
  /** The button that opens the popover. */
  trigger: React.ReactNode;
  /** Hover hint for the trigger. */
  triggerTooltip?: string;
  /**
   * What has already been said about this part of the trace, read above the
   * composer. A count that opens onto an empty form would hide the very
   * comments the count was advertising.
   */
  thread?: React.ReactNode;
}

/**
 * Both annotate and suggest live in popovers anchored to the trigger.
 * Suggest is wider and uses a fixed-height layout so the popover doesn't
 * resize as the user types — the diff panel scrolls internally rather than
 * pushing the textarea around.
 */
export function AnnotationPopover(props: AnnotationPopoverProps) {
  const formState = usePopoverAnnotationForm(props);
  const isSuggest = props.mode === "suggest";

  return (
    <Popover.Root
      open={props.open}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      // lazyMount + unmountOnExit so a closed annotation form is not
      // sitting in DOM (one per turn × two trigger modes = 2N dead
      // popovers on a long conversation otherwise).
      lazyMount
      unmountOnExit
      positioning={{
        placement: "bottom-end",
        // Flip & shift so the popover stays inside the viewport instead of
        // being clipped when opened near an edge. Cuts the "popover gets
        // squeezed and chops off the bottom" failure mode.
        flip: true,
        shift: 16,
        overflowPadding: 16,
      }}
    >
      {props.triggerTooltip ? (
        <Tooltip content={props.triggerTooltip} positioning={{ placement: "top" }}>
          <TriggerAnchor>
            <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
          </TriggerAnchor>
        </Tooltip>
      ) : (
        <Popover.Trigger asChild>{props.trigger}</Popover.Trigger>
      )}
      <Popover.Content
        width={isSuggest ? "560px" : "380px"}
        // The popover caps itself at `--available-height`, the room the
        // positioner measured on the side it settled on. Capping at the
        // viewport height instead replaced that measurement with a number that
        // never binds, so the form kept its natural height and hung off the
        // bottom of a short window with Save below the fold. Keep both: the
        // measured room, and 640px so a tall window does not get a tall form.
        maxHeight="min(640px, var(--available-height, 100vh))"
        overflow="hidden"
        onClick={(e) => e.stopPropagation()}
        bg="bg.panel/92"
      >
        <Popover.Arrow />
        <Popover.Body
          padding={isSuggest ? 4 : 3}
          // The form scrolls; the footer under it does not. Save stays on
          // screen however little room the popover was given.
          overflowY="auto"
          overflowX="hidden"
          minHeight={0}
        >
          {props.thread}
          {isSuggest ? (
            <SuggestBody state={formState} originalOutput={props.output ?? ""} />
          ) : (
            <AnnotateBody state={formState} />
          )}
        </Popover.Body>
        <FormFooter state={formState} padding={isSuggest ? 4 : 3} />
      </Popover.Content>
    </Popover.Root>
  );
}
