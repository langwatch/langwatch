import {
  Box,
  Button,
  chakra,
  Drawer as ChakraDrawer,
  HStack,
  IconButton,
  Portal,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { BOUNDED_BODY, OverlayBodyState } from "../../overlays/overlay-body.tsx";
import { OverlayPortalTargetProvider } from "../../overlays/portal-target.ts";
import { FieldLayoutProvider } from "../forms/field-layout.ts";
import { StudioIsolatedErrorBoundary } from "../states/studio-error-boundary.tsx";
import {
  ActionRow,
  type ActionRowProps,
  type FrameAction,
  FrameActionButton,
} from "./action-row.tsx";
import { CloseButton } from "./close-button.tsx";

export type { ActionRowProps, FrameAction } from "./action-row.tsx";
export { useOverlayPortalTarget } from "../../overlays/portal-target.ts";

const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

let endInset = 0;
const endInsetListeners = new Set<() => void>();

/** The shell sets the room a docked side panel keeps on the right edge; every drawer yields it. */
export function setDrawerEndInset(px: number): void {
  if (px === endInset) return;
  endInset = px;
  for (const listener of endInsetListeners) listener();
}

export function useDrawerEndInset(): number {
  return React.useSyncExternalStore(
    (listener) => {
      endInsetListeners.add(listener);
      return () => endInsetListeners.delete(listener);
    },
    () => endInset,
    () => 0,
  );
}

/**
 * The panel's ground, border and radius are the recipe's: don't pass `bg`, `background` or
 * `borderRadius` (lint proposal `no-drawer-content-ground`). Width comes from Root's `size`.
 */
export interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: ChakraDrawer.ContentProps["padding"];
  /** `false` drops the inline error boundary: a render crash then closes the drawer. */
  withErrorBoundary?: boolean;
  /** The label the error fallback shows when the crash carries no code. */
  errorScope?: string;
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent(
    {
      portalled = true,
      portalRef,
      offset,
      marginTop,
      withErrorBoundary = true,
      errorScope,
      children,
      ...contentProps
    },
    ref,
  ) {
    const context = React.useContext(DrawerOffsetContext);
    const inset = useDrawerEndInset();
    const guarded = withErrorBoundary && !contentProps.asChild;
    const portalTarget = React.useRef<HTMLDivElement>(null);
    return (
      <Portal disabled={!portalled} container={portalRef}>
        <FieldLayoutProvider value="stacked">
          <ChakraDrawer.Positioner padding={offset} pointerEvents="none">
            <ChakraDrawer.Content
              ref={ref}
              margin={2}
              pointerEvents="auto"
              borderRadius="lg"
              marginTop={
                marginTop ?? (context.marginTop == null ? void 0 : `${context.marginTop}px`)
              }
              marginEnd={inset > 0 ? `${inset}px` : undefined}
              {...contentProps}
            >
              <OverlayPortalTargetProvider value={portalTarget}>
                {guarded ? (
                  <StudioIsolatedErrorBoundary scope={errorScope}>
                    {children}
                  </StudioIsolatedErrorBoundary>
                ) : (
                  children
                )}
              </OverlayPortalTargetProvider>
              {!contentProps.asChild && <div ref={portalTarget} data-overlay-portal-target="" />}
            </ChakraDrawer.Content>
          </ChakraDrawer.Positioner>
        </FieldLayoutProvider>
      </Portal>
    );
  },
);

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  return (
    <ChakraDrawer.CloseTrigger position="absolute" top="3" insetEnd="3" {...props} asChild>
      <CloseButton ref={ref} size="sm" />
    </ChakraDrawer.CloseTrigger>
  );
});

export interface DrawerActionsProps {
  /** The one primary action, rightmost: `<Button colorPalette="orange" type="submit">`. */
  primary?: React.ReactNode;
  /** Closes the drawer by default; pass it when closing goes through the router. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Disables Cancel while a save is in flight (ADR-018: Save is disabled only then too). */
  busy?: boolean;
  /** A secondary action on the left edge: Delete, Duplicate, Test connection. */
  start?: React.ReactNode;
  /**
   * Takes Cancel's place: a second outline action beside the primary, for a drawer that keeps
   * a draft and never closes on its footer (the studio's Save beside Apply). No Cancel then.
   */
  secondary?: React.ReactNode;
  /**
   * Only the row, without the footer around it: for a host that draws the footer itself and
   * may show it outside the drawer (the studio's expanded view). Outside a drawer, pass
   * `secondary` or `onCancel`, since the default Cancel closes the drawer it sits in.
   */
  bare?: boolean;
}

/**
 * The drawer's footer row: `start` on the left, then Cancel (outline) and the primary.
 * @deprecated Use the shape's `footer`, or `ActionRow` outside a drawer.
 */
export function DrawerActions({
  primary,
  onCancel,
  cancelLabel = "Cancel",
  busy = false,
  start,
  secondary,
  bare = false,
}: DrawerActionsProps) {
  const row = (
    <HStack width="full" gap={2}>
      {start}
      <Spacer />
      {secondary ?? <DrawerCancel onCancel={onCancel} cancelLabel={cancelLabel} busy={busy} />}
      {primary}
    </HStack>
  );
  return bare ? row : <ChakraDrawer.Footer>{row}</ChakraDrawer.Footer>;
}

function DrawerCancel({
  onCancel,
  cancelLabel,
  busy,
}: Required<Pick<DrawerActionsProps, "cancelLabel" | "busy">> &
  Pick<DrawerActionsProps, "onCancel">) {
  const cancel = (
    <Button variant="outline" onClick={onCancel} disabled={busy}>
      {cancelLabel}
    </Button>
  );
  if (onCancel) return cancel;
  return <ChakraDrawer.ActionTrigger asChild>{cancel}</ChakraDrawer.ActionTrigger>;
}

/** Product adds custom sizes to Chakra's drawer recipe. */
export type AppDrawerSize = NonNullable<ChakraDrawer.RootProps["size"]> | "2xl";

export interface DrawerRootProps extends Omit<ChakraDrawer.RootProps, "size"> {
  size?: AppDrawerSize;
}

/** Non-modal by default so nested drawers and portalled popovers stay operable. */
export const DrawerRoot = function DrawerRoot({ size, ...props }: DrawerRootProps) {
  return (
    <ChakraDrawer.Root
      modal={false}
      closeOnInteractOutside={false}
      preventScroll={false}
      size={size as ChakraDrawer.RootProps["size"]}
      {...props}
    />
  );
};

/** The shared overlay width scale, as maxima: sm 28rem, md 32rem, lg 42rem, xl 56rem, full. */
export type DrawerSize = "sm" | "md" | "lg" | "xl" | "full";

const DRAWER_WIDTH: Record<DrawerSize, string> = {
  sm: "28rem",
  md: "32rem",
  lg: "42rem",
  xl: "56rem",
  full: "100vw",
};

/**
 * The drawer ground. Ruling Q3 (ADR-002): the shape keeps today's solid ground until Alex has
 * seen light and dark screenshots of `bg.overlay`; flipping is this one line.
 */
const DRAWER_GROUND = "bg";

/** The drawer footer: an ActionRow without Cancel; the X and Escape close (ruling Q2). */
export type DrawerFooterProps = Omit<ActionRowProps, "cancel">;

export interface DrawerProps {
  /** Default true: a routed drawer is mounted only while open. */
  open?: boolean;
  /** A request to close (the X, Escape): the drawer stays until `open` turns false. */
  onClose: () => void;
  /** The stack's back arrow, distinct from close: pass `goBack` when the stack can go back. */
  onBack?: () => void;
  /** A maximum, capped by the viewport and the docked panel's inset. Default "md". */
  size?: DrawerSize;
  /** The drawer's accessible name, kept stable even while `titleContent` edits it. */
  title: string;
  /** Drawn in the title's place: an inline-rename element. `title` still names the drawer. */
  titleContent?: React.ReactNode;
  /** The kind line above the title ("Self-hosted instance"). */
  eyebrow?: { label: string; icon?: React.ReactNode };
  /** One line under the title; it describes the drawer (`aria-describedby`). */
  subtitle?: React.ReactNode;
  /** Status and context chips under the title; they wrap. */
  badges?: React.ReactNode;
  /** At most one, outline: a picker's "New agent". */
  headerAction?: FrameAction;
  /** Compact controls before the X: icon buttons, a labelled version picker. They wrap. */
  headerTools?: React.ReactNode;
  /** Pinned under the header: search, filters, a tabs list. */
  toolbar?: React.ReactNode;
  /** `flush` drops the body padding: the content draws its own panes. */
  body?: "padded" | "flush";
  /** `frame`: the body scrolls. `content`: a bounded flex column whose children own scrolling. */
  bodyScroll?: "frame" | "content";
  /** The body becomes skeleton rows. */
  loading?: boolean;
  /** The body becomes an inline error banner. */
  error?: { title: string; description?: string; onRetry?: () => void };
  /** The drawer owns the form: a `type: "submit"` action submits it. Never wrap a child form. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** The id of the drawer-owned form, so a control elsewhere can name it. */
  formId?: string;
  children?: React.ReactNode;
  /** The one footer; omitted means no footer band. */
  footer?: DrawerFooterProps;
  /** A save in flight: the X, back, Escape and every action wait. */
  busy?: boolean;
  /** The error boundary's label; defaults to the title. */
  errorScope?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  onExitComplete?: () => void;
  /** The content element, for a third-party popup that needs a container. */
  contentRef?: React.Ref<HTMLDivElement>;
  /** Prefixes the slot ids: `<id>-close`, `<id>-back`, `<id>-body`. */
  "data-testid"?: string;
}

/** The drawer shape: props in, one look out. The part statics are deprecated. */
export function DrawerShape({
  open = true,
  onClose,
  onBack,
  size = "md",
  title,
  titleContent,
  eyebrow,
  subtitle,
  badges,
  headerAction,
  headerTools,
  toolbar,
  body = "padded",
  bodyScroll = "frame",
  loading = false,
  error,
  onSubmit,
  formId,
  children,
  footer,
  busy = false,
  errorScope,
  initialFocusEl,
  finalFocusEl,
  onExitComplete,
  contentRef,
  "data-testid": testId,
}: DrawerProps) {
  const inset = useDrawerEndInset();
  const slot = (name: string) => (testId ? `${testId}-${name}` : undefined);
  const frame = (
    <>
      <ChakraDrawer.Header>
        <HStack align="start" gap={2} width="full">
          {onBack && (
            <IconButton
              type="button"
              aria-label="Back"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={busy}
              marginStart={-2}
              data-testid={slot("back")}
            >
              <ArrowLeft aria-hidden />
            </IconButton>
          )}
          <VStack align="stretch" gap={1} flex={1} minWidth={0}>
            {eyebrow && (
              <HStack color="fg.muted" gap={2} textStyle="xs">
                {eyebrow.icon}
                <Text>{eyebrow.label}</Text>
              </HStack>
            )}
            <ChakraDrawer.Title overflowWrap="anywhere" srOnly={titleContent != null}>
              {title}
            </ChakraDrawer.Title>
            {titleContent}
            {subtitle != null && <ChakraDrawer.Description>{subtitle}</ChakraDrawer.Description>}
            {badges != null && (
              <HStack gap={2} flexWrap="wrap" paddingTop={1}>
                {badges}
              </HStack>
            )}
          </VStack>
          {headerAction && (
            <FrameActionButton action={headerAction} kind="secondary" busy={busy} size="sm" />
          )}
          {headerTools != null && (
            <HStack gap={1} flexShrink={0} flexWrap="wrap" justify="flex-end">
              {headerTools}
            </HStack>
          )}
        </HStack>
      </ChakraDrawer.Header>
      {toolbar != null && (
        <Box
          paddingX={6}
          paddingY={3}
          borderBottomWidth="1px"
          borderColor="border.card"
          flexShrink={0}
        >
          {toolbar}
        </Box>
      )}
      <ChakraDrawer.Body
        padding={body === "flush" ? 0 : undefined}
        {...(bodyScroll === "content" ? BOUNDED_BODY : {})}
        data-body={body}
        data-testid={slot("body")}
      >
        <OverlayBodyState loading={loading} error={error}>
          {children}
        </OverlayBodyState>
      </ChakraDrawer.Body>
      {footer && (
        <ChakraDrawer.Footer>
          <ActionRow {...footer} busy={busy || footer.busy} />
        </ChakraDrawer.Footer>
      )}
    </>
  );
  return (
    <DrawerRoot
      open={open}
      size={size === "full" ? "full" : undefined}
      closeOnEscape={!busy}
      initialFocusEl={initialFocusEl}
      finalFocusEl={finalFocusEl}
      onExitComplete={onExitComplete}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
    >
      <DrawerContent
        ref={contentRef}
        bg={DRAWER_GROUND}
        maxWidth={`min(${DRAWER_WIDTH[size]}, calc(100vw - 1rem - ${inset}px))`}
        width="full"
        withErrorBoundary={false}
        aria-label={title}
        data-size={size}
        data-testid={testId}
      >
        <DrawerCloseTrigger disabled={busy} data-testid={slot("close")} />
        <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={[title]}>
          {onSubmit ? (
            <chakra.form
              id={formId}
              display="contents"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
            >
              {frame}
            </chakra.form>
          ) : (
            frame
          )}
        </StudioIsolatedErrorBoundary>
      </DrawerContent>
    </DrawerRoot>
  );
}

/**
 * `<Drawer title onClose footer={{ primaryAction }}>`. The part statics (`Drawer.Root`, ...) are
 * deprecated and go in W-final; outside the package, render the shape.
 */
export const Drawer = Object.assign(DrawerShape, {
  /** @deprecated Render `<Drawer>` (the shape); the parts go in W-final. */
  Root: DrawerRoot,
  /** @deprecated The shape draws its own X. */
  CloseTrigger: DrawerCloseTrigger,
  /** @deprecated A routed drawer opens by navigation. */
  Trigger: ChakraDrawer.Trigger,
  /** @deprecated Render `<Drawer>` (the shape). */
  Content: DrawerContent,
  /** @deprecated Use the shape's `title`, `eyebrow`, `subtitle`, `badges`, `headerTools`. */
  Header: ChakraDrawer.Header,
  /** @deprecated The shape's children are its body; `body="flush"` drops the padding. */
  Body: ChakraDrawer.Body,
  /** @deprecated Use the shape's `footer`. */
  Footer: ChakraDrawer.Footer,
  /** @deprecated Use the shape's `footer`, or `ActionRow` outside a drawer. */
  Actions: DrawerActions,
  /** @deprecated Use the shape's `subtitle`. */
  Description: ChakraDrawer.Description,
  /** @deprecated Use the shape's `title`. */
  Title: ChakraDrawer.Title,
  /** @deprecated Use the shape's `footer`. */
  ActionTrigger: ChakraDrawer.ActionTrigger,
});

export { Drawer as RawDrawer } from "@chakra-ui/react";
