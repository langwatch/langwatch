/**
 * One board in the saved-dashboards list, after the prototype's sidebar row: one truncated
 * line, a quiet gauge on the member's default, and a "⋮" menu (Set as default, Rename, Share,
 * Duplicate, Delete; Share and Delete only for a member who may use them). Rename edits inline.
 */

import { Box, Button, Link as ChakraLink, HStack, Text } from "@chakra-ui/react";
import { DASHBOARD_VISIBILITIES, type DashboardVisibility } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Check, Copy, Gauge, MoreVertical, Pencil, Share2, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { boardVisibilityLabel } from "../../model/board-visibility.ts";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import { VISIBILITY_ICONS } from "./board-visibility-control.tsx";

export type SavedDashboardRowActions = {
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  /** Whether this is the board the member lands on; its menu item is then checked. */
  isDefault: boolean;
  onSetDefault: () => void;
  onDuplicate: () => void;
  /** Absent for a member who may not change who sees the board (AC26). */
  share?: { visibility: DashboardVisibility; onChange: (visibility: DashboardVisibility) => void };
  /** Absent for a member who may not delete the board (AC26). */
  onDelete?: () => void;
};

export function SavedDashboardRow({
  name,
  href,
  icon,
  isActive,
  actions,
}: {
  name: string;
  href: string;
  icon: ReactNode;
  isActive: boolean;
  actions?: SavedDashboardRowActions;
}) {
  const host = useAnalyticsHost();
  if (actions?.isRenaming) {
    return <RenameField name={name} actions={actions} />;
  }

  return (
    <Box
      as="li"
      listStyleType="none"
      position="relative"
      width="full"
      _hover={{ "& .row-menu": { opacity: 1 } }}
      _focusWithin={{ "& .row-menu": { opacity: 1 } }}
    >
      <ChakraLink
        href={href}
        display="flex"
        alignItems="center"
        gap={2.5}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="5px"
        fontSize="13px"
        fontWeight={isActive ? "medium" : "normal"}
        color={isActive ? "fg" : "fg.subtle"}
        background={isActive ? "border" : "transparent"}
        textDecoration="none"
        _hover={{ color: "fg", background: isActive ? "border" : "border/50" }}
        aria-current={isActive ? "page" : void 0}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        <Box as="span" display="flex" flexShrink={0}>
          {icon}
        </Box>
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
        {actions?.isDefault && (
          <Box as="span" display="flex" flexShrink={0} color="fg.subtle">
            <Gauge size={11} aria-label="Your default dashboard" />
          </Box>
        )}
        {actions && <Box width="20px" flexShrink={0} marginLeft="auto" />}
      </ChakraLink>
      {actions && <RowMenu name={name} isActive={isActive} actions={actions} />}
    </Box>
  );
}

function RowMenu({
  name,
  isActive,
  actions,
}: {
  name: string;
  isActive: boolean;
  actions: SavedDashboardRowActions;
}) {
  return (
    <Box
      className="row-menu"
      position="absolute"
      right={1}
      top="50%"
      transform="translateY(-50%)"
      opacity={isActive ? 1 : 0}
      transition="opacity 0.2s"
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="2xs" variant="ghost" color="gray.400" aria-label={`Actions for ${name}`}>
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content minWidth="196px">
          <Menu.Item
            value="set-default"
            disabled={actions.isDefault}
            onClick={actions.onSetDefault}
          >
            <MenuRow icon={<Gauge size={13} />} isChecked={actions.isDefault}>
              Set as default
            </MenuRow>
          </Menu.Item>
          <Menu.Item value="rename" onClick={actions.onRenameStart}>
            <MenuRow icon={<Pencil size={13} />}>Rename</MenuRow>
          </Menu.Item>
          {actions.share && <ShareMenu share={actions.share} />}
          <Menu.Item value="duplicate" onClick={actions.onDuplicate}>
            <MenuRow icon={<Copy size={13} />}>Duplicate</MenuRow>
          </Menu.Item>
          {actions.onDelete && (
            <>
              <Menu.Separator />
              <Menu.Item value="delete" color="red.fg" onClick={actions.onDelete}>
                <MenuRow icon={<Trash2 size={13} />}>Delete</MenuRow>
              </Menu.Item>
            </>
          )}
        </Menu.Content>
      </Menu.Root>
    </Box>
  );
}

function MenuRow({
  icon,
  isChecked = false,
  children,
}: {
  icon: ReactNode;
  isChecked?: boolean;
  children: ReactNode;
}) {
  return (
    <HStack width="full" gap={2} fontSize="12.5px">
      {icon}
      <Text as="span" flex="1">
        {children}
      </Text>
      {isChecked && <Check size={13} aria-label="selected" />}
    </HStack>
  );
}

/** The audiences as a submenu; the current one is checked. */
function ShareMenu({ share }: { share: NonNullable<SavedDashboardRowActions["share"]> }) {
  return (
    <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
      <Menu.TriggerItem value="share">
        <MenuRow icon={<Share2 size={13} />}>Share</MenuRow>
      </Menu.TriggerItem>
      <Menu.Content>
        <Menu.RadioItemGroup
          value={share.visibility}
          onValueChange={({ value }) => {
            const picked = DASHBOARD_VISIBILITIES.find((option) => option === value);
            if (picked) share.onChange(picked);
          }}
        >
          {DASHBOARD_VISIBILITIES.map((option) => {
            const Icon = VISIBILITY_ICONS[option];
            return (
              <Menu.RadioItem key={option} value={option}>
                <HStack gap={2} fontSize="12.5px">
                  <Icon size={13} />
                  {boardVisibilityLabel(option)}
                </HStack>
              </Menu.RadioItem>
            );
          })}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

function RenameField({ name, actions }: { name: string; actions: SavedDashboardRowActions }) {
  return (
    <Box as="li" listStyleType="none" width="full" paddingX={1}>
      <InlineTextField
        value={name}
        label="Dashboard name"
        size="xs"
        fontSize="13px"
        onCancel={actions.onRenameCancel}
        onCommit={(draft) => {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== name) actions.onRenameCommit(trimmed);
          else actions.onRenameCancel();
        }}
      />
    </Box>
  );
}
