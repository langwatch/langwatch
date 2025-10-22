import { Alert, Text } from "@chakra-ui/react";
import { Lock } from "react-feather";
import type { Permission } from "../server/api/rbac";

interface PermissionAlertProps {
  permission: Permission;
  message?: string;
  show?: boolean;
  alertProps?: any;
}

/**
 * Reusable alert component for showing permission-denied messages
 * Single Responsibility: Display permission restriction alerts to users
 */
export function PermissionAlert({
  message,
  alertProps = {},
}: PermissionAlertProps) {
  const defaultMessage = `You don't have permission to view this content.`;
  const alertMessage = message ?? defaultMessage;

  return (
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
  );
}
