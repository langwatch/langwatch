/**
 * The per-category read/write picker both drawers and the CLI authorize screen
 * render, and the counter above it.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/PermissionCategoryList.tsx`
 * unchanged except for where `categoryAccessAvailability` comes from. A row the
 * caller cannot grant renders LOCKED rather than hidden, which is the whole
 * point of the surface: a reader who cannot see why a permission is unavailable
 * asks support instead of asking their administrator.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ChevronsUpDown, Lock } from "lucide-react";
import {
  type AccessLevel,
  PERMISSION_CATEGORIES,
  type PermissionCategory,
} from "@langwatch/api-key-contract";
import { categoryAccessAvailability } from "../../model/api-key-permissions";

export type PermissionSelection = "none" | AccessLevel;

export function PermissionCounter({ count }: { count: number }) {
  return (
    <HStack gap={1.5}>
      <Lock size={13} color="var(--chakra-colors-fg-muted)" />
      <Text fontSize="xs" color="fg.muted">
        {count} selected permission{count !== 1 ? "s" : ""}
      </Text>
    </HStack>
  );
}

const LABELS: Record<PermissionSelection, string> = {
  none: "None",
  read: "Read",
  write: "Write",
};

function PermissionRow({
  category,
  value,
  userPermissions,
  onChange,
}: {
  category: PermissionCategory;
  value: PermissionSelection;
  userPermissions: string[];
  onChange: (next: PermissionSelection) => void;
}) {
  const { canRead, canWrite } = categoryAccessAvailability({
    category,
    userPermissions,
  });
  const isDisabled = !canRead && !canWrite;
  const isActive = value !== "none";

  const options: Array<{ value: PermissionSelection; label: string }> = [];
  if (canRead) options.push({ value: "read", label: "Read" });
  if (canWrite) options.push({ value: "write", label: "Write" });
  options.push({ value: "none", label: "None" });

  const trigger = (
    <HStack
      gap={0.5}
      cursor={isDisabled ? "not-allowed" : "pointer"}
      opacity={isDisabled ? 0.4 : 1}
      _hover={isDisabled ? undefined : { opacity: 0.7 }}
    >
      <Text
        fontSize="sm"
        color={isActive ? "fg" : "fg.muted"}
        fontWeight={isActive ? "500" : "400"}
      >
        {LABELS[value]}
      </Text>
      <ChevronsUpDown size={12} color="var(--chakra-colors-fg-subtle)" />
    </HStack>
  );

  if (isDisabled) {
    return (
      <HStack justify="space-between" paddingY={3}>
        <HStack gap={1.5}>
          <Text fontSize="sm" color="fg.muted">
            {category.label}
          </Text>
          <Tooltip content={`Your role does not include access to ${category.label.toLowerCase()}`}>
            <Box color="fg.subtle" cursor="help">
              <Lock size={12} />
            </Box>
          </Tooltip>
        </HStack>
        {trigger}
      </HStack>
    );
  }

  return (
    <HStack justify="space-between" paddingY={3}>
      <Text fontSize="sm">{category.label}</Text>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Box>{trigger}</Box>
        </Menu.Trigger>
        <Menu.Content minWidth="120px">
          {options.map((opt) => (
            <Menu.Item key={opt.value} value={opt.value} onClick={() => onChange(opt.value)}>
              {opt.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}

export function PermissionCategoryList({
  selections,
  userPermissions,
  onChange,
}: {
  selections: Record<string, PermissionSelection>;
  userPermissions: string[];
  onChange: (next: Record<string, PermissionSelection>) => void;
}) {
  return (
    <Box width="full" borderWidth="1px" borderColor="border" borderRadius="lg" paddingX={4}>
      {PERMISSION_CATEGORIES.map((category, i) => (
        <Box
          key={category.key}
          borderBottomWidth={i < PERMISSION_CATEGORIES.length - 1 ? "1px" : 0}
          borderColor="border.muted"
        >
          <PermissionRow
            category={category}
            value={selections[category.key] ?? "none"}
            userPermissions={userPermissions}
            onChange={(next) => {
              onChange({ ...selections, [category.key]: next });
            }}
          />
        </Box>
      ))}
    </Box>
  );
}
