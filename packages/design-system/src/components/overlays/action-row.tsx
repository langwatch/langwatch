/**
 * The footer row both overlay shapes draw, and a host may draw outside an overlay (studio panels).
 * Buttons are descriptors: the row picks variant, colour and size, so a footer cannot drift.
 * Spec: packages/design-system/adrs/002-overlay-and-card-shapes.md.
 */
import { Box, HStack, Spacer, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { Button } from "../forms/button.tsx";
import { useProductAccent } from "../scope/use-product-accent.ts";
import { Menu } from "./menu.tsx";
import { Tooltip } from "./tooltip.tsx";

interface FrameActionLook {
  /** Sentence-case verb: "Save", "Create budget", "Revoke 3 links". */
  label: string;
  /** A save in flight; also blocks the button. */
  loading?: boolean;
  /** Disabled only with a reason, shown as a tooltip: never validation (ADR-018). */
  disabledReason?: string;
  /** 14px lucide, leading. */
  icon?: ReactNode;
  /** Primary only: paints it red, for a destroying confirm. */
  danger?: boolean;
  "data-testid"?: string;
  /** The guided tour's spotlight target. */
  "data-tour"?: string;
}

/** An ordinary button: runs `onClick`, renders `type="button"`. */
export interface FrameButtonAction extends FrameActionLook {
  onClick: () => void;
  type?: never;
  items?: never;
  href?: never;
  target?: never;
  rel?: never;
  onNavigate?: never;
  onActivate?: never;
}

/** Submits a form: the overlay's own (`onSubmit`), or a child's by its id (`form`). */
export interface FrameSubmitAction extends FrameActionLook {
  type: "submit";
  /** The id of a form the child content owns; omitted, the enclosing overlay form. */
  form?: string;
  onClick?: never;
  items?: never;
  href?: never;
  target?: never;
  rel?: never;
  onNavigate?: never;
  onActivate?: never;
}

export interface FrameMenuItem {
  value: string;
  label: string;
  icon?: ReactNode;
  disabledReason?: string;
  onSelect: () => void;
}

/** A menu button: each item runs its own `onSelect`. */
export interface FrameMenuAction extends FrameActionLook {
  items: FrameMenuItem[];
  onClick?: never;
  type?: never;
  href?: never;
  target?: never;
  rel?: never;
  onNavigate?: never;
  onActivate?: never;
}

/**
 * A real anchor in the button's look. A plain click may close the overlay (`onActivate`) and route
 * in-app (`onNavigate`); a modified click, middle click or `_blank` stays native.
 */
export interface FrameLinkAction extends FrameActionLook {
  href: string;
  /** `_blank` adds `noopener` to the supplied `rel`. */
  target?: string;
  rel?: string;
  /** Called once on a plain click with the href, which then does not navigate natively. */
  onNavigate?: (args: { href: string }) => void;
  /** Called on a plain click, before `onNavigate`: close the overlay. */
  onActivate?: () => void;
  onClick?: never;
  type?: never;
  form?: never;
  items?: never;
}

/** One button the shape draws. The caller never picks variant, colour, size or `type`. */
export type FrameAction = FrameButtonAction | FrameSubmitAction | FrameMenuAction | FrameLinkAction;

/** The colour meaning of a secondary outline action; omitted is neutral. */
export type FrameSecondaryTone = "neutral" | "danger" | "success" | "info";

/** A secondary descriptor: a `FrameAction` that may carry a tone. */
export type FrameSecondaryAction = FrameAction & { tone?: FrameSecondaryTone };

/** The primary action's colour meaning; omitted is the accent. `danger` wins over it. */
export type FramePrimaryTone = "accent" | "neutral" | "success";

/** A primary descriptor: a `FrameAction` that may carry a tone. */
export type FramePrimaryAction = FrameAction & { tone?: FramePrimaryTone };

export interface ActionRowProps {
  /** Solid in the product's accent (red with `danger`, green or inverse with `tone`), rightmost. */
  primaryAction?: FramePrimaryAction;
  /** Outline, left of the primary; its `tone` is danger (red), success (green) or info (blue). */
  secondaryAction?: FrameSecondaryAction;
  /** More outline actions after the singular one, in order; a footer needs no primary for them. */
  secondaryActions?: FrameSecondaryAction[];
  /** Ghost red, on the left edge: Delete, Archive. */
  destructiveAction?: FrameAction;
  /** Ghost, after the destructive one: Duplicate, Test connection. */
  utilityActions?: FrameAction[];
  /** Short inline text on the left: "Step 2 of 3", an acknowledge checkbox. */
  note?: ReactNode;
  /** A full-width block above the row: a totals breakdown. */
  summary?: ReactNode;
  /** Outline, left of the secondary. A dialog draws it by default; a drawer only when given. */
  cancel?: { label?: string; onClick: () => void; "data-testid"?: string };
  /** Every action waits. */
  busy?: boolean;
}

export type FrameActionKind = "primary" | "secondary" | "destructive" | "utility" | "cancel";

const LOOK: Record<FrameActionKind, { variant: "solid" | "outline" | "ghost"; palette?: string }> =
  {
    primary: { variant: "solid" },
    secondary: { variant: "outline" },
    destructive: { variant: "ghost", palette: "red" },
    utility: { variant: "ghost" },
    cancel: { variant: "outline" },
  };

const TONE_PALETTE = { danger: "red", success: "green", info: "blue" } as const;

/** Scoped overrides: the outline recipe pins neutral fg, border and hover. */
function toneStyle(tone: FrameSecondaryTone | undefined) {
  if (tone === undefined || tone === "neutral") return undefined;
  return {
    colorPalette: TONE_PALETTE[tone],
    color: "colorPalette.fg",
    borderColor: "colorPalette.muted",
    bg: "transparent",
    _hover: { backgroundColor: "colorPalette.subtle" },
    _expanded: { backgroundColor: "colorPalette.subtle" },
  } as const;
}

/** Neutral confirmation: the inverse button, near-black in light mode and light in dark mode. */
const NEUTRAL_PRIMARY = { bg: "fg", color: "bg.panel", _hover: { opacity: 0.9 } } as const;

/** The primary's palette and paint: danger wins, then the tone, then the product accent. */
function primaryLook({
  action,
  primaryTone,
  accent,
}: {
  action: FrameAction;
  primaryTone: FramePrimaryTone | undefined;
  accent: { colorPalette: string };
}) {
  if (action.danger) return { palette: "red", toned: undefined };
  if (primaryTone === "success") return { palette: "green", toned: undefined };
  const toned = primaryTone === "neutral" ? NEUTRAL_PRIMARY : undefined;
  return { palette: accent.colorPalette, toned };
}

function relFor({ rel, target }: { rel?: string; target?: string }) {
  if (target !== "_blank") return rel;
  const tokens = (rel ?? "").split(/\s+/).filter(Boolean);
  return [...new Set([...tokens, "noopener"])].join(" ");
}

/** An unprevented primary click with no modifier, aimed at this window: the app may route it. */
function isPlainActivation({ event, target }: { event: ReactMouseEvent; target?: string }) {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const sameWindow = target === undefined || target === "_self";
  return !event.defaultPrevented && event.button === 0 && !modified && sameWindow;
}

interface LinkStyle {
  palette: string | undefined;
  size: "sm" | undefined;
  toned: ReturnType<typeof toneStyle> | typeof NEUTRAL_PRIMARY;
}

/** A link action drawn as an anchor in the button look; unavailable, it loses its href. */
function FrameLink({
  action,
  kind,
  unavailable,
  style,
}: {
  action: FrameLinkAction;
  kind: FrameActionKind;
  unavailable: boolean;
  style: LinkStyle;
}) {
  const { href, target } = action;
  return (
    <Button
      asChild
      variant={LOOK[kind].variant}
      colorPalette={style.palette}
      {...style.toned}
      size={style.size}
      aria-busy={action.loading ? true : undefined}
      opacity={unavailable ? 0.6 : undefined}
      cursor={unavailable ? "not-allowed" : undefined}
      data-frame-action={kind}
      data-testid={action["data-testid"]}
      data-tour={action["data-tour"]}
    >
      <a
        href={unavailable ? undefined : href}
        target={target}
        rel={relFor({ rel: action.rel, target })}
        role={unavailable ? "link" : undefined}
        aria-disabled={unavailable ? true : undefined}
        onClick={(event) => {
          if (unavailable) return event.preventDefault();
          if (!isPlainActivation({ event, target })) return;
          action.onActivate?.();
          if (!action.onNavigate) return;
          event.preventDefault();
          action.onNavigate({ href });
        }}
        onAuxClick={(event) => unavailable && event.preventDefault()}
        onKeyDown={(event) => unavailable && event.key === "Enter" && event.preventDefault()}
      >
        {action.icon}
        {action.label}
      </a>
    </Button>
  );
}

/** One descriptor drawn as a button; the shapes use it for their header action too. */
export function FrameActionButton({
  action,
  kind,
  busy = false,
  size,
  tone,
  primaryTone,
}: {
  action: FrameAction;
  kind: FrameActionKind;
  busy?: boolean;
  size?: "sm";
  tone?: FrameSecondaryTone;
  primaryTone?: FramePrimaryTone;
}) {
  const look = LOOK[kind];
  const accent = useProductAccent();
  const primary = kind === "primary" ? primaryLook({ action, primaryTone, accent }) : undefined;
  const palette = primary ? primary.palette : look.palette;
  const toned = kind === "secondary" ? toneStyle(tone) : primary?.toned;
  const submits = action.type === "submit";
  const blocked = busy || action.loading === true;
  const unavailable = blocked || action.disabledReason !== undefined;
  const button =
    action.href !== undefined ? (
      <FrameLink
        action={action}
        kind={kind}
        unavailable={unavailable}
        style={{ palette, size, toned }}
      />
    ) : (
      <Button
        type={submits ? "submit" : "button"}
        form={submits ? action.form : undefined}
        variant={look.variant}
        colorPalette={palette}
        {...toned}
        size={size}
        loading={action.loading}
        disabled={busy || action.disabledReason !== undefined}
        onClick={
          action.items
            ? undefined
            : () => {
                if (!blocked) action.onClick?.();
              }
        }
        data-frame-action={kind}
        data-testid={action["data-testid"]}
        data-tour={action["data-tour"]}
      >
        {action.icon}
        {action.label}
        {action.items && <ChevronDown size={14} aria-hidden />}
      </Button>
    );
  const menu = action.items ? (
    <Menu.Root
      onSelect={({ value }) => {
        if (!blocked) action.items?.find((item) => item.value === value)?.onSelect();
      }}
    >
      <Menu.Trigger asChild>{button}</Menu.Trigger>
      <Menu.Content>
        {action.items.map((item) => (
          <Menu.Item
            key={item.value}
            value={item.value}
            disabled={blocked || item.disabledReason !== undefined}
            title={item.disabledReason}
          >
            {item.icon}
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  ) : (
    button
  );
  if (action.disabledReason === undefined) return menu;
  // A disabled button takes no pointer events, so the reason hangs on a focusable wrapper.
  return (
    <Tooltip content={action.disabledReason}>
      <Box as="span" display="inline-flex" tabIndex={0} aria-label={action.disabledReason}>
        {menu}
      </Box>
    </Tooltip>
  );
}

/** The footer row: destructive and utilities on the left, then Cancel, secondary and primary. */
export function ActionRow({
  primaryAction,
  secondaryAction,
  secondaryActions = [],
  destructiveAction,
  utilityActions = [],
  note,
  summary,
  cancel,
  busy = false,
}: ActionRowProps) {
  const row = (
    <HStack width="full" gap={2} flexWrap="wrap" data-action-row="">
      {destructiveAction && (
        <FrameActionButton action={destructiveAction} kind="destructive" busy={busy} />
      )}
      {utilityActions.map((action) => (
        <FrameActionButton key={action.label} action={action} kind="utility" busy={busy} />
      ))}
      {note != null && (
        <Box textStyle="sm" color="fg.muted" minWidth={0}>
          {note}
        </Box>
      )}
      <Spacer />
      {cancel && (
        <FrameActionButton
          action={{
            label: cancel.label ?? "Cancel",
            onClick: cancel.onClick,
            "data-testid": cancel["data-testid"],
          }}
          kind="cancel"
          busy={busy}
        />
      )}
      {secondaryAction && (
        <FrameActionButton
          action={secondaryAction}
          kind="secondary"
          busy={busy}
          tone={secondaryAction.tone}
        />
      )}
      {secondaryActions.map((action) => (
        <FrameActionButton
          key={action.label}
          action={action}
          kind="secondary"
          busy={busy}
          tone={action.tone}
        />
      ))}
      {primaryAction && (
        <FrameActionButton
          action={primaryAction}
          kind="primary"
          busy={busy}
          primaryTone={primaryAction.tone}
        />
      )}
    </HStack>
  );
  if (summary == null) return row;
  return (
    <VStack align="stretch" width="full" gap={3}>
      <Box>{summary}</Box>
      {row}
    </VStack>
  );
}
