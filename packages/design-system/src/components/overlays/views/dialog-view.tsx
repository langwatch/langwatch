import {
  chakra,
  Dialog as ChakraDialog,
  HStack,
  IconButton,
  mergeRefs,
  Portal,
  useDialogContext,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { firstFocusable } from "../../../overlays/focusable.ts";
import { registerOpenModal } from "../../../overlays/modal-stack.ts";
import { BOUNDED_BODY, OverlayBodyState } from "../../../overlays/overlay-body.tsx";
import { OverlayPortalTargetProvider } from "../../../overlays/portal-target.ts";
import { FieldLayoutProvider } from "../../forms/field-layout.ts";
import { StudioIsolatedErrorBoundary } from "../../states/studio-error-boundary.tsx";
import { ActionRow, type FrameAction } from "../action-row.tsx";
import { CloseButton } from "../close-button.tsx";

export type { ActionRowProps, FrameAction } from "../action-row.tsx";

export type DialogRootProps = Omit<ChakraDialog.RootProps, "size"> & {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "5xl" | "6xl" | "cover" | "full";
};

/** @deprecated Render `<Dialog>` (the shape); the parts go in W-final. */
export function DialogRoot(props: DialogRootProps) {
  return <ChakraDialog.Root {...(props as ChakraDialog.RootProps)} />;
}

export interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement | null>;
  backdrop?: boolean;
  backdropProps?: Omit<ChakraDialog.BackdropProps, "bg" | "background" | "backgroundColor">;
  positionerProps?: ChakraDialog.PositionerProps;
  /** `false` drops the inline error boundary: a render crash then closes the dialog. */
  withErrorBoundary?: boolean;
  /** The label the error fallback shows when the crash carries no code. */
  errorScope?: string;
}

/** @deprecated Render `<Dialog>` (the shape). */
export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent(
    {
      portalled = true,
      portalRef,
      backdrop = true,
      backdropProps,
      positionerProps,
      withErrorBoundary = true,
      errorScope,
      children,
      ...contentProps
    },
    ref,
  ) {
    const portalTarget = React.useRef<HTMLDivElement | null>(null);
    const { open } = useDialogContext();
    React.useEffect(() => (open ? registerOpenModal() : undefined), [open]);
    const guarded = withErrorBoundary;
    return (
      <Portal disabled={!portalled} container={portalRef}>
        {backdrop && (
          <ChakraDialog.Backdrop
            backdropFilter="var(--lw-backdrop-blur, blur(8px))"
            {...backdropProps}
            background="transparent"
            data-lw-transparent-backdrop="true"
          />
        )}
        <FieldLayoutProvider value="stacked">
          <OverlayPortalTargetProvider value={portalTarget}>
            <ChakraDialog.Positioner {...positionerProps}>
              <ChakraDialog.Content
                ref={contentProps.asChild ? mergeRefs(ref, portalTarget) : ref}
                {...contentProps}
              >
                {contentProps.asChild ? (
                  children
                ) : (
                  <>
                    {guarded ? (
                      <StudioIsolatedErrorBoundary
                        scope={errorScope}
                        recovery={<LegacyCrashShell scope={errorScope} />}
                      >
                        {children}
                      </StudioIsolatedErrorBoundary>
                    ) : (
                      children
                    )}
                    <div ref={portalTarget} data-overlay-portal-target="" />
                  </>
                )}
              </ChakraDialog.Content>
            </ChakraDialog.Positioner>
          </OverlayPortalTargetProvider>
        </FieldLayoutProvider>
      </Portal>
    );
  },
);

/**
 * A crash in a part-built dialog removes its title and X with the rest of the body. The fallback
 * names the dialog again and offers a close request, which the caller's Root answers as for Escape.
 */
function LegacyCrashShell({ scope }: { scope?: string }) {
  return (
    <>
      <ChakraDialog.Title srOnly>{scope ?? "Something went wrong"}</ChakraDialog.Title>
      <DialogCloseTrigger />
    </>
  );
}

/** @deprecated The shape draws its own X. */
export const DialogCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDialog.CloseTriggerProps
>(function DialogCloseTrigger(props, ref) {
  return (
    <ChakraDialog.CloseTrigger position="absolute" top="2" insetEnd="2" {...props} asChild>
      <CloseButton ref={ref} size="sm">
        {props.children}
      </CloseButton>
    </ChakraDialog.CloseTrigger>
  );
});

/** The shared overlay width scale, as maxima capped by the viewport. */
export type DialogSize = "sm" | "md" | "lg" | "xl";

const DIALOG_WIDTH: Record<DialogSize, string> = {
  sm: "28rem",
  md: "32rem",
  lg: "42rem",
  xl: "56rem",
};

/** The two places a dialog frame stands: near the top, or centred on the viewport. */
export type DialogPlacement = "top" | "center";

export interface DialogProps {
  open: boolean;
  /** A request to close (X, Escape, outside, Cancel): the dialog stays until `open` is false. */
  onClose: () => void;
  /** Sentence case; names the thing and the act. Always the accessible name. */
  title: string;
  /** Under the title, fg.muted; it describes the dialog (`aria-describedby`). */
  description?: React.ReactNode;
  /** 18px, before the title. */
  icon?: React.ReactNode;
  /** Default "sm"; the body scrolls inside the frame. */
  size?: DialogSize;
  /** Where the frame sits. Omitted, it keeps the dialog recipe's own placement (top). */
  placement?: DialogPlacement;
  /** Step two of a two-step dialog. */
  onBack?: () => void;
  /** The dialog owns the form: a `type: "submit"` action submits it. Never wrap a child form. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** The id of the dialog-owned form, so a control elsewhere can name it. */
  formId?: string;
  children?: React.ReactNode;
  /** `danger` for a destroying act. */
  primaryAction?: FrameAction;
  /** Takes Cancel's place: "Keep links paused", "Later", "Stay here". */
  secondaryAction?: FrameAction;
  /**
   * Default "Cancel"; "Close" for a read-only dialog. `null` drops the footer button when one
   * primary action finishes the job; the X and Escape still close it under `dismissible`.
   */
  cancelLabel?: string | null;
  /** Footer left: the acknowledge checkbox, "Step 2 of 2". */
  note?: React.ReactNode;
  /** `false`: no X, no Cancel, no Escape, no outside click; only the actions close it. */
  dismissible?: boolean;
  /**
   * `false`: a click outside leaves it open (a once-shown secret); X and Escape still close it,
   * under `dismissible` and `busy` as ever. Default true.
   */
  closeOnInteractOutside?: boolean;
  /** "alertdialog" for a must-acknowledge or destroying confirm. Default "dialog". */
  role?: "dialog" | "alertdialog";
  /** Shorthand for `initialFocusEl`; falls back to the first field, then Cancel. */
  initialFocus?: "primary" | "cancel" | "secondary";
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  onExitComplete?: () => void;
  /** `content`: a bounded flex column whose children own scrolling (editors). */
  bodyScroll?: "frame" | "content";
  loading?: boolean;
  error?: { title: string; description?: string; onRetry?: () => void };
  /** A save in flight: the X, Cancel, Escape, outside click, form submit and every action wait. */
  busy?: boolean;
  errorScope?: string;
  /** Names the entity shown: a crash clears when it changes, even if the title stays the same. */
  entityKey?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  /** Prefixes the slot ids: `<id>-close`, `<id>-back`, `<id>-body`. */
  "data-testid"?: string;
}

/** The dialog shape: props in, one look out. The part statics are deprecated. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  size = "sm",
  placement,
  onBack,
  onSubmit,
  formId,
  children,
  primaryAction,
  secondaryAction,
  cancelLabel = "Cancel",
  note,
  dismissible = true,
  closeOnInteractOutside = true,
  role = "dialog",
  initialFocus,
  initialFocusEl,
  finalFocusEl,
  onExitComplete,
  bodyScroll = "frame",
  loading = false,
  error,
  busy = false,
  errorScope,
  entityKey,
  contentRef,
  "data-testid": testId,
}: DialogProps) {
  const ownRef = React.useRef<HTMLDivElement>(null);
  const slot = (name: string) => (testId ? `${testId}-${name}` : undefined);
  const closable = dismissible && !busy;
  const cancel =
    dismissible && !secondaryAction && cancelLabel !== null
      ? { label: cancelLabel, onClick: onClose }
      : undefined;
  const hasFooter = primaryAction ?? secondaryAction ?? cancel ?? note;
  const pickInitialFocus = () => {
    const usable = (selector: string) => firstFocusable(ownRef.current, selector);
    const requested = initialFocus ? usable(`[data-frame-action="${initialFocus}"]`) : null;
    return requested ?? usable("input, textarea, select") ?? usable('[data-frame-action="cancel"]');
  };
  const resetKeys = [title, entityKey];
  const frame = (
    <>
      <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
        <ChakraDialog.Header>
          <HStack gap={2} align="center" minWidth={0}>
            {onBack && (
              <IconButton
                type="button"
                aria-label="Back"
                variant="ghost"
                size="xs"
                onClick={onBack}
                disabled={busy}
                marginStart={-1}
                data-testid={slot("back")}
              >
                <ArrowLeft aria-hidden />
              </IconButton>
            )}
            {icon != null && (
              <chakra.span display="inline-flex" color="fg.muted" aria-hidden>
                {icon}
              </chakra.span>
            )}
            <ChakraDialog.Title>{title}</ChakraDialog.Title>
          </HStack>
          {description != null && (
            <ChakraDialog.Description textStyle="sm" color="fg.muted">
              {description}
            </ChakraDialog.Description>
          )}
        </ChakraDialog.Header>
        <ChakraDialog.Body
          {...(bodyScroll === "content" ? BOUNDED_BODY : { overflowY: "auto" as const })}
          data-testid={slot("body")}
        >
          <OverlayBodyState loading={loading} error={error}>
            {children}
          </OverlayBodyState>
        </ChakraDialog.Body>
      </StudioIsolatedErrorBoundary>
      {hasFooter != null && (
        <ChakraDialog.Footer>
          <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
            <ActionRow
              primaryAction={primaryAction}
              secondaryAction={secondaryAction}
              cancel={cancel}
              note={note}
              busy={busy}
            />
          </StudioIsolatedErrorBoundary>
        </ChakraDialog.Footer>
      )}
    </>
  );
  return (
    <ChakraDialog.Root
      open={open}
      placement={placement}
      role={role}
      closeOnEscape={closable}
      closeOnInteractOutside={closable && closeOnInteractOutside}
      initialFocusEl={initialFocusEl ?? pickInitialFocus}
      finalFocusEl={finalFocusEl}
      onExitComplete={onExitComplete}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
    >
      <DialogContent
        ref={mergeRefs(ownRef, contentRef)}
        maxWidth={`min(${DIALOG_WIDTH[size]}, calc(100vw - 2rem))`}
        width="full"
        maxHeight="calc(100dvh - 4rem)"
        withErrorBoundary={false}
        aria-label={title}
        data-size={size}
        data-testid={testId}
      >
        {dismissible && <DialogCloseTrigger disabled={busy} data-testid={slot("close")} />}
        {onSubmit ? (
          <chakra.form
            id={formId}
            display="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) onSubmit(event);
            }}
          >
            {frame}
          </chakra.form>
        ) : (
          frame
        )}
      </DialogContent>
    </ChakraDialog.Root>
  );
}

/** @deprecated Render `<Dialog>` (the shape); the parts go in W-final. */
Dialog.Root = DialogRoot;
/** @deprecated Render `<Dialog>` (the shape). */
Dialog.Content = DialogContent;
/** @deprecated The shape draws its own X. */
Dialog.CloseTrigger = DialogCloseTrigger;
/** @deprecated Use the shape's actions. */
Dialog.Footer = ChakraDialog.Footer;
/** @deprecated Use the shape's `title`, `icon`, `onBack`. */
Dialog.Header = ChakraDialog.Header;
/** @deprecated The shape's children are its body. */
Dialog.Body = ChakraDialog.Body;
/** @deprecated Use the shape's `title`. */
Dialog.Title = ChakraDialog.Title;
/** @deprecated Use the shape's `description`. */
Dialog.Description = ChakraDialog.Description;
/** @deprecated Open a dialog from state. */
Dialog.Trigger = ChakraDialog.Trigger;
/** @deprecated The shape draws Cancel. */
Dialog.ActionTrigger = ChakraDialog.ActionTrigger;
