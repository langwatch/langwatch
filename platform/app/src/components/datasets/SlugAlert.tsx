import { Alert } from "@chakra-ui/react";

/**
 * Alert component for displaying slug-related alerts.
 *
 * Single Responsibility: Base wrapper for slug-related warnings with default styling.
 */
export function SlugAlert({
  children,
  ...props
}: { children: React.ReactNode } & Alert.RootProps) {
  return (
    <Alert.Root status="warning" size="sm" {...props}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
