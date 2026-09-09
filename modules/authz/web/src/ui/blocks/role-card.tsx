/**
 * One role, built-in or custom, as a card in the grid.
 *
 * Moved from `platform/app/src/components/settings/RoleCard.tsx`, whose only
 * caller was the page that moved with it. The one substitution is the grant
 * type: the platform component took `hasPermission: (permission: Permission) => boolean`
 * where `Permission` was an alias re-exported from `~/server/api/rbac`, a
 * server module a browser package may not reach. The grant is asked of the host
 * as a string, so the prop is one too.
 */

import { Badge, Button, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { Edit, Eye, Shield, Trash2 } from "lucide-react";
import type { ComponentType } from "react";

export function RoleCard({
  name,
  description,
  permissionCount,
  isDefault = false,
  icon: Icon = Shield,
  onDelete,
  onEdit,
  onViewPermissions,
  hasPermission,
}: {
  name: string;
  description: string;
  permissionCount: string;
  isDefault?: boolean;
  icon?: ComponentType<{ size?: number }>;
  onDelete?: () => void;
  onEdit?: () => void;
  onViewPermissions?: () => void;
  hasPermission: (permission: string) => boolean;
}) {
  const canManage = hasPermission("organization:manage");

  return (
    <Card.Root
      width="100%"
      height="100%"
      borderWidth="1px"
      borderColor="border"
      _hover={onViewPermissions ? { borderColor: "orange.400", shadow: "md" } : {}}
      transition="all 0.2s"
      display="flex"
      flexDirection="column"
      cursor={onViewPermissions && canManage ? "pointer" : "default"}
      onClick={onViewPermissions && canManage ? onViewPermissions : undefined}
      position="relative"
    >
      {/* Action buttons, positioned absolutely so they centre against the card. */}
      {!isDefault && (
        <HStack
          gap={1}
          onClick={(event) => event.stopPropagation()}
          position="absolute"
          right={4}
          top="50%"
          transform="translateY(-50%)"
        >
          {onViewPermissions && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="blue"
              aria-label={`View permissions for ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onViewPermissions();
              }}
              disabled={!canManage}
            >
              <Eye size={14} />
            </Button>
          )}
          {onEdit && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="orange"
              aria-label={`Edit ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              disabled={!canManage}
            >
              <Edit size={14} />
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="red"
              aria-label={`Delete ${name}`}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              disabled={!canManage}
            >
              <Trash2 size={14} />
            </Button>
          )}
        </HStack>
      )}
      <Card.Header>
        <VStack align="start" gap={1}>
          <HStack>
            <Icon size={18} />
            <Text fontWeight="semibold">{name}</Text>
          </HStack>
          {isDefault && (
            <Text fontSize="xs" color="fg.muted">
              Built-in Role
            </Text>
          )}
        </VStack>
      </Card.Header>
      <Card.Body paddingTop={0} flex={1} display="flex" flexDirection="column">
        <VStack align="start" gap={2} flex={1} width="full" justifyContent="space-between">
          <Text fontSize="sm" color="fg.muted">
            {description}
          </Text>
          {isDefault ? (
            <Badge colorPalette="orange" size="sm">
              {permissionCount}
            </Badge>
          ) : (
            <Text fontSize="xs" color="orange.fg" fontWeight="medium">
              {permissionCount}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
