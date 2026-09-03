/**
 * The notice a surface shows in place of content the reader may not see.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/PermissionAlert.tsx`,
 * with one change: the platform version typed its `permission` prop as
 * `Permission` from `~/server/api/rbac`, a deprecated bare alias for
 * `AuthzPermission` that reached the engine gate and through it a Node-only
 * logger. The RBAC family already replaced that alias everywhere it moved a
 * page; this takes the same line — a permission is a string here, and the one
 * caller passes a literal.
 *
 * Its `react-feather` glyph became the `lucide-react` twin, which is the icon
 * set every moved package already uses.
 */

import { Alert, Box, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import type { ComponentProps } from "react";

export function PermissionAlert({
  message,
  alertProps = {},
  permission,
}: {
  permission: string;
  message?: string;
  show?: boolean;
  alertProps?: Partial<ComponentProps<typeof Alert.Root>>;
}) {
  const defaultMessage = `You don't have permission to view this content. Required permission: ${permission}. Ask your team administrator to request access.`;
  const alertMessage = message ?? defaultMessage;

  return (
    <Box padding={4}>
      <Alert.Root status="warning" {...alertProps}>
        <Alert.Indicator>
          <Lock size={16} />
        </Alert.Indicator>
        <Alert.Content>
          <Alert.Title>Access Restricted</Alert.Title>
          <Alert.Description>
            <Text>{alertMessage}</Text>
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    </Box>
  );
}
