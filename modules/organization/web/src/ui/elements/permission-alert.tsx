/** Permission restriction notice: shown in place of restricted content. */

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
