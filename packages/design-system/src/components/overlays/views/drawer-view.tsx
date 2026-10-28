import {
  Box,
  Button,
  chakra,
  Drawer as ChakraDrawer,
  HStack,
  IconButton,
  mergeRefs,
  Portal,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { DrawerFooterBand, DrawerHeaderBand } from "../../../overlays/drawer-chrome.tsx";
import { useDrawerFocusRestore } from "../../../overlays/drawer-focus.ts";
import { DrawerOffsetContext, useDrawerEndInset } from "../../../overlays/drawer-inset.ts";
import { lastInputWasPointer, useInputModality } from "../../../overlays/input-modality.ts";
import { useHasOpenModal } from "../../../overlays/modal-stack.ts";
import { BOUNDED_BODY, OverlayBodyState } from "../../../overlays/overlay-body.tsx";
import { OverlayPortalTargetProvider } from "../../../overlays/portal-target.ts";
import { useDrawerChrome, useDrawerGlass } from "../../../overlays/use-drawer-chrome.ts";
import { drawerGlassBodyInsets } from "../../../system/drawer.recipe.ts";
import { FieldLayoutProvider } from "../../forms/field-layout.ts";
import { StudioIsolatedErrorBoundary } from "../../states/studio-error-boundary.tsx";
import {
  ActionRow,
  type ActionRowProps,
  type FrameAction,
  FrameActionButton,
} from "../action-row.tsx";
import { CloseButton } from "../close-button.tsx";

export type {
  ActionRowProps,
  FrameAction,
  FramePrimaryAction,
  FramePrimaryTone,
  FrameSecondaryAction,
  FrameSecondaryTone,
} from "../action-row.tsx";

/**
 * The panel's ground, border and radius are the recipe's: don't pass `bg`, `background` or
 * `borderRadius` (lint proposal `no-drawer-content-ground`). Width comes from Root's `size`.
 */
export interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement | null>;
  offset?: ChakraDrawer.ContentProps["padding"];
  /** `false` drops the inline error boundary: a render crash then closes the drawer. */
  withErrorBoundary?: boolean;
  /** The label the error fallback shows when the crash carries no code. */
  errorScope?: string;
}

/** A caller's side margin applies on wide screens only; a phone sheet always reaches the edge. */
function floatMargin(value: ChakraDrawer.ContentProps["marginEnd"]) {
  if (value == null) return undefined;
  if (typeof value === "object" && !Array.isArray(value))
    return Object.assign({}, value, { mdDown: 0 });
  return { base: value, md: value, mdDown: 0 };
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent(
    {
      portalled = true,
      portalRef,
      offset,
      marginTop,
      marginStart,
      marginEnd,
      marginBottom,
      withErrorBoundary = true,
      errorScope,
      children,
      ...contentProps
    },
    ref,
  ) {
    const context = React.useContext(DrawerOffsetContext);
    const inset = useDrawerEndInset();
    const guarded = withErrorBoundary;
    const portalTarget = React.useRef<HTMLDivElement | null>(null);
    return (
      <Portal disabled={!portalled} container={portalRef}>
        <FieldLayoutProvider value="stacked">
          <OverlayPortalTargetProvider value={portalTarget}>
            <ChakraDrawer.Positioner padding={offset} pointerEvents="none">
              <ChakraDrawer.Content
                ref={contentProps.asChild ? mergeRefs(ref, portalTarget) : ref}
                // A phone shows every drawer as a full-screen sheet; wider screens float it. The
                // per-side margins below repeat their value at md so they beat this shorthand there.
                margin={{ base: 0, md: 2 }}
                marginStart={floatMargin(marginStart)}
                marginBottom={floatMargin(marginBottom)}
                maxWidth={{ mdDown: "100%" }}
                pointerEvents="auto"
                borderRadius={{ base: 0, md: "lg" }}
                marginTop={
                  marginTop ??
                  (context.marginTop == null
                    ? { mdDown: 0 }
                    : { base: `${context.marginTop}px`, md: `${context.marginTop}px` })
                }
                marginEnd={floatMargin(marginEnd ?? (inset > 0 ? `${inset}px` : undefined))}
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
              </ChakraDrawer.Content>
            </ChakraDrawer.Positioner>
          </OverlayPortalTargetProvider>
        </FieldLayoutProvider>
      </Portal>
    );
  },
);

/**
 * A crash in a part-built drawer removes its title and X with the rest of the body. The fallback
 * names the drawer again and offers a close request, which the caller's Root answers as for Escape.
 */
function LegacyCrashShell({ scope }: { scope?: string }) {
  return (
    <>
      <ChakraDrawer.Title srOnly>{scope ?? "Something went wrong"}</ChakraDrawer.Title>
      <DrawerCloseTrigger />
    </>
  );
}

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  useInputModality();
  const [pointerFocus, setPointerFocus] = React.useState(false);
  return (
    <ChakraDrawer.CloseTrigger position="absolute" top="3" insetEnd="3" {...props} asChild>
      <CloseButton
        ref={ref}
        size="sm"
        data-pointer-focus={pointerFocus || undefined}
        onFocus={() => setPointerFocus(lastInputWasPointer())}
        onBlur={() => setPointerFocus(false)}
        css={{ "&[data-pointer-focus]:focus-visible": { outline: "none" } }}
      />
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

/**
 * Non-modal by default so nested drawers and portalled popovers stay operable. Opened on top of a
 * modal dialog it is modal itself: its focus trap pauses the dialog's and hands focus back on
 * close. A non-modal drawer returns focus itself, to `finalFocusEl` or the opener (drawer-focus).
 */
export const DrawerRoot = function DrawerRoot({
  size,
  onOpenChange,
  onExitComplete,
  ...props
}: DrawerRootProps) {
  const overModal = useHasOpenModal();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(props.defaultOpen ?? false);
  const handleExitComplete = useDrawerFocusRestore({
    open: props.open ?? uncontrolledOpen,
    modal: props.modal ?? overModal,
    finalFocusEl: props.finalFocusEl,
    onExitComplete,
  });
  return (
    <ChakraDrawer.Root
      modal={overModal}
      closeOnInteractOutside={false}
      preventScroll={false}
      size={size as ChakraDrawer.RootProps["size"]}
      {...props}
      onExitComplete={handleExitComplete}
      onOpenChange={(details) => {
        setUncontrolledOpen(details.open);
        onOpenChange?.(details);
      }}
    />
  );
};

/**
 * The shared overlay width scale, as maxima: sm 28rem, md 32rem, detail 38.5rem, lg 42rem,
 * xl 56rem, wide 59.375rem, workspace 87.5rem, full. `detail` and `wide` are named steps,
 * never arbitrary widths.
 */
export type DrawerSize = "sm" | "md" | "detail" | "lg" | "xl" | "wide" | "workspace" | "full";

const DRAWER_WIDTH: Record<DrawerSize, string> = {
  sm: "28rem",
  md: "32rem",
  detail: "38.5rem",
  lg: "42rem",
  xl: "56rem",
  wide: "59.375rem",
  workspace: "87.5rem",
  full: "100vw",
};

/** The studio header's 56px clearance (`marginTop="14"`), plus the 8px bottom gap. */
const STUDIO_HEADER_TOP = "3.5rem";

/**
 * The drawer ground. Ruling Q3 (ADR-002): the shape keeps today's solid ground until Alex has
 * seen light and dark screenshots of `bg.overlay`; flipping is this one line.
 */
const DRAWER_GROUND = "bg";

/** The recipe's 16px footer padding, grown on a device whose home indicator would cover it. */
const FOOTER_SAFE_AREA = "max(var(--chakra-spacing-4), env(safe-area-inset-bottom, 0px))";

/**
 * The drawer footer is an ActionRow. It draws no Cancel unless the descriptor carries `cancel`
 * (ruling 2026-10-11: a drawer that has one keeps it); the X and Escape close either way.
 * `secondaryActions` adds outline actions, each with an optional tone; no primary is needed.
 */
export type DrawerFooterProps = ActionRowProps;

/** The descriptor footer, or one node that owns the whole footer row. */
type DrawerFooterChoice =
  | {
      /** The one footer; omitted means no footer band. */
      footer?: DrawerFooterProps;
      footerContent?: never;
    }
  | {
      footer?: never;
      /**
       * Replaces only the ActionRow's contents, inside the same measured band. `null`: no band.
       * No Cancel is added. The caller passes `busy` to its own controls and guards their
       * callbacks, including an already-open portalled menu.
       */
      footerContent: React.ReactNode;
    };

/** `standard` draws the generated header; `content` lets one header node own the top band. */
type DrawerChromeChoice =
  | { chrome?: "standard"; headerContent?: never }
  | {
      /** Transparent bounded frame, flush body; the children own the visible header and scroll. */
      chrome: "content";
      /** The visible header band. The frame draws the one X; this node draws none. */
      headerContent: React.ReactNode;
    };

interface DrawerBaseProps {
  /** Default true: a routed drawer is mounted only while open. */
  open?: boolean;
  /** A request to close (the X, Escape): the drawer stays until `open` turns false. */
  onClose: () => void;
  /** The stack's back arrow, distinct from close: pass `goBack` when the stack can go back. */
  onBack?: () => void;
  /** A maximum, capped by the viewport and the docked panel's inset. Default "md". */
  size?: DrawerSize;
  /** The side it opens from; "start" leaves a panel docked on the right in view. Default "end". */
  placement?: "start" | "end";
  /** The drawer's accessible name, kept stable even while `titleContent` edits it. */
  title: string;
  /** Drawn in the title's place: an inline-rename element. `title` still names the drawer. */
  titleContent?: React.ReactNode;
  /** Before the title, decorative, kept at the size given (24px glyphs stay 24px). */
  icon?: React.ReactNode;
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
  /** `studio-header` keeps the studio's 56px top clearance; the docked end inset is unaffected. */
  topInset?: "default" | "studio-header";
  /** A save in flight: the X, back, Escape and every action wait. */
  busy?: boolean;
  /**
   * `false`, or a yes/no guard read when Escape is pressed: a floating editor that owns the key
   * answers `false`. Never an event; busy always wins. Default true.
   */
  closeOnEscape?: boolean | (() => boolean);
  /** `true` locks the document scroll while open. Default false. */
  preventScroll?: boolean;
  /**
   * Beside a companion panel: `follow` eases the margin as the panel docks; `wait` also holds the
   * entrance 450ms for a floating one. Omitted, the drawer moves as before.
   */
  companionMotion?: "follow" | "wait";
  /** `raised`: an opaque panel footer whose shadow shows while content waits beneath it. */
  footerAppearance?: "default" | "raised";
  /** The Back button's test id, when it is not `<data-testid>-back`. */
  backButtonTestId?: string;
  /** The error boundary's label; defaults to the title. */
  errorScope?: string;
  /** Names the entity shown: a crash clears when it changes, even if the title stays the same. */
  entityKey?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  onExitComplete?: () => void;
  /** The content element, for a third-party popup that needs a container. */
  contentRef?: React.Ref<HTMLDivElement>;
  /** Prefixes the slot ids: `<id>-close`, `<id>-back`, `<id>-body`. */
  "data-testid"?: string;
}

export type DrawerProps = DrawerBaseProps & DrawerFooterChoice & DrawerChromeChoice;

type DrawerFrameProps = Pick<
  DrawerProps,
  | "onBack"
  | "title"
  | "titleContent"
  | "icon"
  | "backButtonTestId"
  | "eyebrow"
  | "subtitle"
  | "badges"
  | "headerAction"
  | "headerTools"
  | "toolbar"
  | "body"
  | "bodyScroll"
  | "loading"
  | "error"
  | "children"
  | "footer"
  | "footerContent"
  | "chrome"
  | "headerContent"
  | "busy"
  | "errorScope"
  | "entityKey"
  | "footerAppearance"
> & { testId?: string };

type DrawerHeaderRowProps = Pick<
  DrawerFrameProps,
  | "onBack"
  | "title"
  | "titleContent"
  | "icon"
  | "backButtonTestId"
  | "eyebrow"
  | "subtitle"
  | "badges"
  | "headerAction"
  | "headerTools"
  | "busy"
>;

/** The header row: back button, eyebrow, icon and title lines, subtitle, badges and tools. */
function DrawerHeaderRow({
  onBack,
  title,
  titleContent,
  icon,
  backButtonTestId,
  eyebrow,
  subtitle,
  badges,
  headerAction,
  headerTools,
  busy = false,
}: DrawerHeaderRowProps) {
  const titleLines = (
    <>
      <ChakraDrawer.Title overflowWrap="anywhere" srOnly={titleContent != null}>
        {title}
      </ChakraDrawer.Title>
      {titleContent}
    </>
  );
  return (
    <HStack align="start" gap={2} width="full" flexWrap="wrap">
      {onBack && (
        <IconButton
          type="button"
          aria-label="Back"
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={busy}
          marginStart={-2}
          data-testid={backButtonTestId}
        >
          <ArrowLeft aria-hidden />
        </IconButton>
      )}
      <VStack align="stretch" gap={1} flex="1 1 10rem" minWidth={0}>
        {eyebrow && (
          <HStack color="fg.muted" gap={2} textStyle="xs">
            {eyebrow.icon}
            <Text>{eyebrow.label}</Text>
          </HStack>
        )}
        {icon != null ? (
          <HStack align="flex-start" gap={2} minWidth={0}>
            <chakra.span
              display="inline-flex"
              flexShrink={0}
              alignItems="center"
              justifyContent="center"
              minWidth="24px"
              minHeight="24px"
              color="fg.muted"
              aria-hidden
            >
              {icon}
            </chakra.span>
            <VStack align="stretch" gap={1} flex={1} minWidth={0}>
              {titleLines}
            </VStack>
          </HStack>
        ) : (
          titleLines
        )}
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
  );
}

/**
 * Header band, body and footer. With the glass switch on and a framed body the band and footer
 * overlay the body's scrollport and its padding follows their measured heights; content-owned
 * bodies and the solid look keep the bands as flex siblings.
 */
function DrawerFrame({
  onBack,
  title,
  titleContent,
  icon,
  backButtonTestId,
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
  children,
  footer,
  footerContent,
  chrome: chromeMode = "standard",
  headerContent,
  busy = false,
  errorScope,
  entityKey,
  footerAppearance = "default",
  testId,
}: DrawerFrameProps) {
  const contentMode = chromeMode === "content";
  const hasFooter = footer != null || (footerContent !== undefined && footerContent !== null);
  const glass = useDrawerGlass({ framed: bodyScroll === "frame" && !contentMode });
  const raised = footerAppearance === "raised" && hasFooter;
  const chrome = useDrawerChrome({ enabled: glass || raised, hasFooter });
  const slot = (name: string) => (testId ? `${testId}-${name}` : undefined);
  const resetKeys = [title, entityKey];
  if (contentMode) {
    return (
      <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
        <ChakraDrawer.Title srOnly>{title}</ChakraDrawer.Title>
        <Box flexShrink={0} paddingEnd={12} data-drawer-header-content="">
          {headerContent}
        </Box>
        <ChakraDrawer.Body
          {...BOUNDED_BODY}
          padding={0}
          flex={1}
          data-body="flush"
          data-testid={slot("body")}
        >
          <OverlayBodyState loading={loading} error={error}>
            {children}
          </OverlayBodyState>
        </ChakraDrawer.Body>
      </StudioIsolatedErrorBoundary>
    );
  }
  return (
    <>
      <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
        <DrawerHeaderBand glass={glass} edge={chrome.edges.top} bandRef={chrome.headerRef}>
          <ChakraDrawer.Header>
            <DrawerHeaderRow
              onBack={onBack}
              title={title}
              titleContent={titleContent}
              icon={icon}
              backButtonTestId={backButtonTestId ?? slot("back")}
              eyebrow={eyebrow}
              subtitle={subtitle}
              badges={badges}
              headerAction={headerAction}
              headerTools={headerTools}
              busy={busy}
            />
          </ChakraDrawer.Header>
          {toolbar != null && (
            <Box
              paddingX={6}
              paddingY={3}
              borderTopWidth={glass ? "1px" : 0}
              borderBottomWidth={glass ? 0 : "1px"}
              borderColor="border.card"
              flexShrink={0}
            >
              {toolbar}
            </Box>
          )}
        </DrawerHeaderBand>
        <ChakraDrawer.Body
          ref={chrome.bodyRef}
          padding={body === "flush" ? 0 : void 0}
          {...(bodyScroll === "content" ? BOUNDED_BODY : {})}
          {...(glass ? drawerGlassBodyInsets({ flush: body === "flush" }) : {})}
          data-body={body}
          data-testid={slot("body")}
        >
          <OverlayBodyState loading={loading} error={error}>
            {children}
          </OverlayBodyState>
        </ChakraDrawer.Body>
      </StudioIsolatedErrorBoundary>
      {hasFooter && (
        <DrawerFooterBand
          glass={glass && !raised}
          raised={raised}
          edge={chrome.edges.bottom}
          bandRef={chrome.footerRef}
          paddingBottom={FOOTER_SAFE_AREA}
        >
          <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={resetKeys}>
            {footer ? <ActionRow {...footer} busy={busy || footer.busy} /> : footerContent}
          </StudioIsolatedErrorBoundary>
        </DrawerFooterBand>
      )}
    </>
  );
}

const COMPANION_TRANSITION = "margin 240ms cubic-bezier(0.32, 0.72, 0, 1)";
const COMPANION_MOTION = {
  follow: { transition: COMPANION_TRANSITION },
  wait: {
    transition: COMPANION_TRANSITION,
    _open: { animationDelay: "450ms", animationFillMode: "backwards" as const },
  },
};

/** The drawer shape: props in, one look out. The part statics are deprecated. */
export function Drawer({
  open = true,
  onClose,
  onBack,
  size = "md",
  placement = "end",
  title,
  titleContent,
  icon,
  eyebrow,
  subtitle,
  badges,
  headerAction,
  headerTools,
  toolbar,
  body,
  bodyScroll,
  loading,
  error,
  onSubmit,
  formId,
  children,
  footer,
  footerContent,
  chrome,
  headerContent,
  topInset = "default",
  busy = false,
  backButtonTestId,
  errorScope,
  entityKey,
  initialFocusEl,
  finalFocusEl,
  onExitComplete,
  contentRef,
  closeOnEscape = true,
  preventScroll = false,
  footerAppearance,
  companionMotion,
  "data-testid": testId,
}: DrawerProps) {
  const inset = useDrawerEndInset();
  const slot = (name: string) => (testId ? `${testId}-${name}` : undefined);
  const glass = useDrawerGlass({ framed: bodyScroll !== "content" && chrome !== "content" });
  const footerChoice = footerContent === undefined ? { footer } : { footerContent };
  const chromeChoice = chrome === "content" ? { chrome, headerContent } : {};
  const frame = (
    <DrawerFrame
      onBack={onBack}
      title={title}
      titleContent={titleContent}
      icon={icon}
      backButtonTestId={backButtonTestId}
      eyebrow={eyebrow}
      subtitle={subtitle}
      badges={badges}
      headerAction={headerAction}
      headerTools={headerTools}
      toolbar={toolbar}
      body={body}
      bodyScroll={bodyScroll}
      loading={loading}
      error={error}
      {...footerChoice}
      {...chromeChoice}
      busy={busy}
      errorScope={errorScope}
      entityKey={entityKey}
      footerAppearance={footerAppearance}
      testId={testId}
    >
      {children}
    </DrawerFrame>
  );
  return (
    <DrawerRoot
      open={open}
      size={size === "full" ? "full" : undefined}
      placement={placement}
      closeOnEscape={!busy && closeOnEscape !== false}
      preventScroll={preventScroll}
      onEscapeKeyDown={(event) => {
        if (typeof closeOnEscape === "function" && !closeOnEscape()) event.preventDefault();
      }}
      initialFocusEl={initialFocusEl}
      finalFocusEl={finalFocusEl}
      onExitComplete={onExitComplete}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
    >
      <DrawerContent
        ref={contentRef}
        bg={chrome === "content" ? "transparent" : DRAWER_GROUND}
        {...(chrome === "content" ? { overflow: "hidden" } : {})}
        {...(companionMotion ? COMPANION_MOTION[companionMotion] : {})}
        {...(topInset === "studio-header"
          ? { marginTop: "14", height: `calc(100dvh - ${STUDIO_HEADER_TOP} - 0.5rem)` }
          : {})}
        maxWidth={{
          base: "100%",
          md: `min(${DRAWER_WIDTH[size]}, calc(100vw - 1rem - ${inset}px))`,
        }}
        width="full"
        withErrorBoundary={false}
        aria-label={title}
        data-size={size}
        data-testid={testId}
      >
        <DrawerCloseTrigger
          disabled={busy}
          zIndex={glass || chrome === "content" ? 2 : void 0}
          data-testid={slot("close")}
        />
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
      </DrawerContent>
    </DrawerRoot>
  );
}

/** @deprecated Render `<Drawer>` (the shape); the parts go in W-final. */
Drawer.Root = DrawerRoot;
/** @deprecated The shape draws its own X. */
Drawer.CloseTrigger = DrawerCloseTrigger;
/** @deprecated A routed drawer opens by navigation. */
Drawer.Trigger = ChakraDrawer.Trigger;
/** @deprecated Render `<Drawer>` (the shape). */
Drawer.Content = DrawerContent;
/** @deprecated Use the shape's `title`, `eyebrow`, `subtitle`, `badges`, `headerTools`. */
Drawer.Header = ChakraDrawer.Header;
/** @deprecated The shape's children are its body; `body="flush"` drops the padding. */
Drawer.Body = ChakraDrawer.Body;
/** @deprecated Use the shape's `footer`. */
Drawer.Footer = ChakraDrawer.Footer;
/** @deprecated Use the shape's `footer`, or `ActionRow` outside a drawer. */
Drawer.Actions = DrawerActions;
/** @deprecated Use the shape's `subtitle`. */
Drawer.Description = ChakraDrawer.Description;
/** @deprecated Use the shape's `title`. */
Drawer.Title = ChakraDrawer.Title;
/** @deprecated Use the shape's `footer`. */
Drawer.ActionTrigger = ChakraDrawer.ActionTrigger;
