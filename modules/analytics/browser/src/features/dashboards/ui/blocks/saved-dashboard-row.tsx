/**
 * One board in the saved-dashboards list: a link, an optional tag, and for a
 * board the member owns a "⋮" menu with rename and delete. Renaming swaps the
 * link for an inline field; Enter or leaving it saves, Escape cancels.
 */

import { Badge, Box, Button, Input } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MenuLink } from "../../../../ui/elements/analytics-menu-link.tsx";

export type SavedDashboardRowActions = {
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
};

export function SavedDashboardRow({
  name,
  href,
  icon,
  isActive,
  tag,
  actions,
}: {
  name: string;
  href: string;
  icon: ReactNode;
  isActive: boolean;
  tag?: string;
  actions?: SavedDashboardRowActions;
}) {
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
      <MenuLink
        href={href}
        paddingX={2}
        icon={icon}
        isSelected={isActive}
        menuEnd={renderMenuEnd(tag, actions)}
      >
        {name}
      </MenuLink>
      {actions && <RowMenu name={name} isActive={isActive} actions={actions} />}
    </Box>
  );
}

function renderMenuEnd(tag: string | undefined, actions: SavedDashboardRowActions | undefined) {
  if (tag) {
    return (
      <Badge size="xs" variant="plain" color="fg.subtle" textTransform="uppercase">
        {tag}
      </Badge>
    );
  }
  if (actions) return <Box width="20px" />;
  return void 0;
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
          <Button size="2xs" variant="ghost" aria-label={`Actions for ${name}`}>
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="rename" onClick={actions.onRenameStart}>
            Rename
          </Menu.Item>
          <Menu.Item value="delete" color="red.500" onClick={actions.onDelete}>
            Delete
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </Box>
  );
}

function RenameField({ name, actions }: { name: string; actions: SavedDashboardRowActions }) {
  const [draft, setDraft] = useState(name);
  // Enter settles the field and the blur that follows must not settle it twice.
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) actions.onRenameCommit(trimmed);
    else actions.onRenameCancel();
  };

  return (
    <Box as="li" listStyleType="none" width="full" paddingX={1}>
      <Input
        ref={inputRef}
        size="xs"
        aria-label="Dashboard name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            settled.current = true;
            actions.onRenameCancel();
          }
        }}
      />
    </Box>
  );
}
