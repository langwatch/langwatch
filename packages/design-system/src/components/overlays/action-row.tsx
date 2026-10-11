/**
 * The footer row both overlay shapes draw, and a host may draw outside an overlay (studio panels).
 * Buttons are descriptors: the row picks variant, colour and size, so a footer cannot drift.
 * Spec: packages/design-system/adrs/002-overlay-and-card-shapes.md.
 */
import { Box, Button, HStack, Spacer, VStack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

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
}

/** An ordinary button: runs `onClick`, renders `type="button"`. */
export interface FrameButtonAction extends FrameActionLook {
  onClick: () => void;
  type?: never;
  items?: never;
}

/** Submits a form: the overlay's own (`onSubmit`), or a child's by its id (`form`). */
export interface FrameSubmitAction extends FrameActionLook {
  type: "submit";
  /** The id of a form the child content owns; omitted, the enclosing overlay form. */
  form?: string;
  onClick?: never;
  items?: never;
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
}

/** One button the shape draws. The caller never picks variant, colour, size or `type`. */
export type FrameAction = FrameButtonAction | FrameSubmitAction | FrameMenuAction;

export interface ActionRowProps {
  /** Solid orange (red with `danger`), rightmost. */
  primaryAction?: FrameAction;
  /** Outline, left of the primary. */
  secondaryAction?: FrameAction;
  /** Ghost red, on the left edge: Delete, Archive. */
  destructiveAction?: FrameAction;
  /** Ghost, after the destructive one: Duplicate, Test connection. */
  utilityActions?: FrameAction[];
  /** Short inline text on the left: "Step 2 of 3", an acknowledge checkbox. */
  note?: ReactNode;
  /** A full-width block above the row: a totals breakdown. */
  summary?: ReactNode;
  /** Dialogs only: drawers close by their X and Escape. */
  cancel?: { label?: string; onClick: () => void };
  /** Every action waits. */
  busy?: boolean;
}

export type FrameActionKind = "primary" | "secondary" | "destructive" | "utility" | "cancel";

const LOOK: Record<FrameActionKind, { variant: "solid" | "outline" | "ghost"; palette?: string }> =
  {
    primary: { variant: "solid", palette: "orange" },
    secondary: { variant: "outline" },
    destructive: { variant: "ghost", palette: "red" },
    utility: { variant: "ghost" },
    cancel: { variant: "outline" },
  };

/** One descriptor drawn as a button; the shapes use it for their header action too. */
export function FrameActionButton({
  action,
  kind,
  busy = false,
  size,
}: {
  action: FrameAction;
  kind: FrameActionKind;
  busy?: boolean;
  size?: "sm";
}) {
  const look = LOOK[kind];
  const palette = kind === "primary" && action.danger ? "red" : look.palette;
  const submits = action.type === "submit";
  const blocked = busy || action.loading === true;
  const button = (
    <Button
      type={submits ? "submit" : "button"}
      form={submits ? action.form : undefined}
      variant={look.variant}
      colorPalette={palette}
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
          action={{ label: cancel.label ?? "Cancel", onClick: cancel.onClick }}
          kind="cancel"
          busy={busy}
        />
      )}
      {secondaryAction && (
        <FrameActionButton action={secondaryAction} kind="secondary" busy={busy} />
      )}
      {primaryAction && <FrameActionButton action={primaryAction} kind="primary" busy={busy} />}
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
