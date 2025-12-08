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
      borderColor="gray.200"
      _hover={
        onViewPermissions ? { borderColor: "orange.400", shadow: "md" } : {}
      }
      transition="all 0.2s"
      display="flex"
      flexDirection="column"
      cursor={onViewPermissions ? "pointer" : "default"}
      onClick={onViewPermissions ? onViewPermissions : undefined}
    >
      <Card.Header>
        <HStack justify="space-between" align="start">
          <VStack align="start" gap={1} flex={1}>
            <HStack>
              <Icon size={18} /> {/* Use the passed icon instead of Shield */}
              <Text fontWeight="semibold">{name}</Text>
            </HStack>
            {isDefault && (
              <Text fontSize="xs" color="gray.500">
                Built-in Role
              </Text>
            )}
          </VStack>
          {!isDefault && (
            <HStack gap={1} onClick={(e) => e.stopPropagation()}>
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
        </HStack>
      </Card.Header>
      <Card.Body paddingTop={0} flex={1} display="flex" flexDirection="column">
        <VStack align="start" gap={2} flex={1} width="full">
          <Text fontSize="sm" color="gray.600">
            {description}
          </Text>
          {isDefault ? (
            <Badge colorPalette="orange" size="sm">
              {permissionCount}
            </Badge>
          ) : (
            <Text fontSize="xs" color="orange.600" fontWeight="medium">
              {permissionCount}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
