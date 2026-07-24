import { Box, HStack, Text } from "@chakra-ui/react";
import { ChevronsUpDown, Lock } from "lucide-react";
import { Menu } from "../../../components/ui/menu";
import { Tooltip } from "../../../components/ui/tooltip";
import {
  PERMISSION_CATEGORIES,
  type AccessLevel,
  type PermissionCategory,
} from "../../../server/api-key/permission-categories";
import { hasPermissionWithHierarchy } from "../../../server/api/rbac";

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
  const canRead = category.readPermissions.every((p) =>
    hasPermissionWithHierarchy(userPermissions, p),
  );
  const canWrite =
    category.writePermissions.length > 0 &&
    category.writePermissions.every((p) =>
      hasPermissionWithHierarchy(userPermissions, p),
    );
  const isDisabled = !canRead;
  const isActive = value !== "none";

  const options: Array<{ value: PermissionSelection; label: string }> = [];
  if (canRead) options.push({ value: "read", label: "Read" });
  if (canWrite && category.accessLevels.includes("write"))
    options.push({ value: "write", label: "Write" });
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
            <Menu.Item
              key={opt.value}
              value={opt.value}
              onClick={() => onChange(opt.value)}
            >
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
    <Box
      width="full"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      paddingX={4}
    >
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
