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
import { ActionRow, type FramePrimaryAction, type FrameSecondaryAction } from "../action-row.tsx";
import { CloseButton } from "../close-button.tsx";

export type {
  ActionRowProps,
  FrameAction,
  FramePrimaryAction,
  FramePrimaryTone,
} from "../action-row.tsx";

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
export type DialogSize = "sm" | "md" | "detail" | "lg" | "xl";

const DIALOG_WIDTH: Record<DialogSize, string> = {
  sm: "28rem",
  md: "32rem",
  detail: "38.5rem",
  lg: "42rem",
  xl: "56rem",
};

const FOOTER_DIVIDER = {
  borderTopWidth: "1px",
  borderTopStyle: "solid",
  borderColor: "border",
} as const;

const ASSISTANT_SURFACE = {
  background: "bg.card",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "border.muted",
  overflow: "hidden",
  boxShadow: "0 28px 90px -32px color-mix(in srgb, {colors.bg.scrim} 62%, transparent)",
} as const;

/** The two places a dialog frame stands: near the top, or centred on the viewport. */
export type DialogPlacement = "top" | "center";

interface DialogBaseProps {
  open: boolean;
  /** A request to close (X, Escape, outside, Cancel): the dialog stays until `open` is false. */
  onClose: () => void;
  /** Sentence case; names the thing and the act. Always the accessible name. */
  title: string;
  /** Default "sm"; the body scrolls inside the frame. */
  size?: DialogSize;
  /** Where the frame sits. Omitted, it keeps the dialog recipe's own placement (top). */
  placement?: DialogPlacement;
  /** The dialog owns the form: a `type: "submit"` action submits it. Never wrap a child form. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** The id of the dialog-owned form, so a control elsewhere can name it. */
  formId?: string;
  children?: React.ReactNode;
  /** `card`: the card ground, for a dialog over a card-toned page; `panel`: the panel ground. */
  ground?: "card" | "panel";
  /** `padded` (default) or `flush`: the body draws no padding, its children own the spacing. */
  body?: "padded" | "flush";
  /** `assistant`: the card ground, muted border and deep shadow of the Langy assistant frame. */
  surface?: "default" | "assistant";
  /** A rule above the footer. Default false. */
  footerDivider?: boolean;
  /** `false`: no X, no Cancel, no Escape, no outside click; only the actions close it. */
  dismissible?: boolean;
  /**
   * `false`: a click outside leaves it open (a once-shown secret); X and Escape still close it,
   * under `dismissible` and `busy` as ever. Default true.
   */
  closeOnInteractOutside?: boolean;
  /** `false`: Escape leaves it open (a child list owns Escape). Never enables Escape while busy. */
  closeOnEscape?: boolean;
  /** `false` only for an integration whose picker lives outside the frame. Default true. */
  trapFocus?: boolean;
  /** `false` leaves the document scrollable. Default true. */
  preventScroll?: boolean;
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

/** The descriptor footer, or one `footerContent` node that owns its controls (and its Cancel). */
type DialogFooterChoice =
  | {
      footerContent?: never;
      /** `danger` for a destroying act; `tone` paints it neutral or green. */
      primaryAction?: FramePrimaryAction;
      /** Takes Cancel's place: "Keep links paused", "Later", "Stay here". */
      secondaryAction?: FrameSecondaryAction;
      /** More outline actions after `secondaryAction`, in order, each with an optional tone. */
      secondaryActions?: FrameSecondaryAction[];
      /**
       * Default "Cancel"; "Close" for a read-only dialog. `null` drops the footer button when one
       * primary action finishes the job; the X and Escape still close it under `dismissible`.
       */
      cancelLabel?: string | null;
      /** Footer left: the acknowledge checkbox, "Step 2 of 2". */
      note?: React.ReactNode;
    }
  | {
      /** Replaces the whole footer row. The caller passes `busy` to its own controls. */
      footerContent: React.ReactNode;
      primaryAction?: never;
      secondaryAction?: never;
      secondaryActions?: never;
      cancelLabel?: never;
      note?: never;
    };

/** The default heading row, or one `headerContent` node under a hidden semantic title. */
type DialogHeaderChoice =
  | {
      headerContent?: never;
      /** Under the title, fg.muted; it describes the dialog (`aria-describedby`). */
      description?: React.ReactNode;
      /** 18px, before the title. */
      icon?: React.ReactNode;
      /** Step two of a two-step dialog. */
      onBack?: () => void;
    }
  | {
      /** Replaces the visible heading; the X is still the frame's. No Dialog parts inside. */
      headerContent: React.ReactNode;
      description?: never;
      icon?: never;
      onBack?: never;
    };

export type DialogProps = DialogBaseProps & DialogFooterChoice & DialogHeaderChoice;

/** The frame's ground, and the assistant treatment with its scope class. */
function frameLook({ ground, assistant }: { ground?: "card" | "panel"; assistant: boolean }) {
  if (assistant) return { ...ASSISTANT_SURFACE, className: "langy-root" };
  if (ground === "card") return { background: "bg.card" };
  return ground === "panel" ? { background: "bg.panel" } : {};
}

/** What decides whether the descriptor footer draws at all; null draws none. */
function footerOf({
  primaryAction,
  secondaryAction,
  secondaryActions,
  cancel,
  note,
}: {
  primaryAction?: FramePrimaryAction;
  secondaryAction?: FrameSecondaryAction;
  secondaryActions?: FrameSecondaryAction[];
  cancel?: { label?: string; onClick: () => void };
  note?: React.ReactNode;
}) {
  if (secondaryActions?.length) return true;
  return primaryAction ?? secondaryAction ?? cancel ?? note;
}

/** The title row, or the supplied header node under a hidden title; the X stays the frame's. */
function DialogHeading({
  title,
  icon,
  description,
  onBack,
  headerContent,
  assistant,
  busy,
  backTestId,
}: {
  title: string;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  onBack?: () => void;
  headerContent?: React.ReactNode;
  assistant: boolean;
  busy: boolean;
  backTestId?: string;
}) {
  const custom = headerContent !== undefined;
  return (
    <ChakraDialog.Header
      flexDirection="column"
      alignItems="stretch"
      paddingEnd={12}
      {...(assistant ? { paddingBottom: 3 } : {})}
    >
      {custom && <ChakraDialog.Title srOnly>{title}</ChakraDialog.Title>}
      {custom && headerContent}
      {!custom && (
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
              data-testid={backTestId}
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
      )}
      {description != null && (
        <ChakraDialog.Description textStyle="sm" color="fg.muted">
          {description}
        </ChakraDialog.Description>
      )}
    </ChakraDialog.Header>
  );
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
  headerContent,
  footerContent,
  onSubmit,
  formId,
  children,
  primaryAction,
  secondaryAction,
  secondaryActions,
  cancelLabel = "Cancel",
  ground,
  body = "padded",
  surface = "default",
  footerDivider = false,
  note,
  dismissible = true,
  closeOnInteractOutside = true,
  closeOnEscape = true,
  trapFocus = true,
  preventScroll = true,
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
  const hasFooter =
    footerContent !== undefined
      ? footerContent
      : footerOf({ primaryAction, secondaryAction, secondaryActions, cancel, note });
  const assistant = surface === "assistant";
  const pickInitialFocus = () => {
    const usable = (selector: string) => firstFocusable(ownRef.current, selector);
    const requested = initialFocus ? usable(`[data-frame-action="${initialFocus}"]`) : null;
    return requested ?? usable("input, textarea, select") ?? usable('[data-frame-action="cancel"]');
  };
  const resetKeys = [title, entityKey];
  const frame = (
    <>
      <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
        <DialogHeading
          title={title}
          icon={icon}
          description={description}
          onBack={onBack}
          headerContent={headerContent}
          assistant={assistant}
          busy={busy}
          backTestId={slot("back")}
        />
        <ChakraDialog.Body
          {...(bodyScroll === "content" ? BOUNDED_BODY : { overflowY: "auto" as const })}
          {...(body === "flush" ? { padding: 0 } : {})}
          {...(assistant ? { paddingBottom: 4 } : {})}
          data-testid={slot("body")}
        >
          <OverlayBodyState loading={loading} error={error}>
            {children}
          </OverlayBodyState>
        </ChakraDialog.Body>
      </StudioIsolatedErrorBoundary>
      {hasFooter != null && (
        <ChakraDialog.Footer {...(footerDivider ? FOOTER_DIVIDER : {})}>
          <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
            {footerContent !== undefined ? (
              footerContent
            ) : (
              <ActionRow
                primaryAction={primaryAction}
                secondaryAction={secondaryAction}
                secondaryActions={secondaryActions}
                cancel={cancel}
                note={note}
                busy={busy}
              />
            )}
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
      closeOnEscape={closable && closeOnEscape}
      trapFocus={trapFocus}
      preventScroll={preventScroll}
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
        {...frameLook({ ground, assistant })}
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
