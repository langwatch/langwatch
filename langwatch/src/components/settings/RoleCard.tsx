import { Badge, Button, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { Edit, Eye, Shield, Trash2 } from "lucide-react";
import type { Permission } from "../../server/api/rbac";

/**
 * RoleCard component
 *
 * Single Responsibility: Displays a role card with name, description, and action buttons
 */
export function RoleCard({
  name,
  description,
  permissionCount,
  isDefault = false,
  icon: Icon = Shield, // Default to Shield if no icon provided
  onDelete,
  onEdit,
  onViewPermissions,
  hasPermission,
}: {
  name: string;
  description: string;
  permissionCount: string;
  isDefault?: boolean;
  icon?: React.ComponentType<{ size?: number }>; // Add icon prop
  onDelete?: () => void;
  onEdit?: () => void;
  onViewPermissions?: () => void;
  hasPermission: (permission: Permission) => boolean;
}) {
  return (
    <Card.Root
      width="100%"
      height="100%"
      borderWidth="1px"
      borderColor="border"
      _hover={
        onViewPermissions ? { borderColor: "orange.400", shadow: "md" } : {}
      }
      transition="all 0.2s"
      display="flex"
      flexDirection="column"
      cursor={onViewPermissions ? "pointer" : "default"}
      onClick={onViewPermissions ? onViewPermissions : undefined}
      position="relative"
    >
      {/* Action buttons - absolutely positioned to center vertically */}
      {!isDefault && (
        <HStack
          gap={1}
          onClick={(e) => e.stopPropagation()}
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
              onClick={(e) => {
                e.stopPropagation();
                onViewPermissions();
              }}
              disabled={!hasPermission("organization:manage")}
            >
              <Eye size={14} />
            </Button>
          )}
          {onEdit && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="orange"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              disabled={!hasPermission("organization:manage")}
            >
              <Edit size={14} />
            </Button>
          )}
          {onDelete && (
            <Button
              size="sm"
              variant="ghost"
              colorPalette="red"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={!hasPermission("organization:manage")}
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
