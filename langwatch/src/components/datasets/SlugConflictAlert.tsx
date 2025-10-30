import { Alert } from "@chakra-ui/react";

/**
 * Alert component for displaying slug conflict warnings.
 *
 * Single Responsibility: Displays a warning when a dataset slug conflicts with an existing dataset.
 *
 * @param conflictsWith - The name of the dataset that already uses this slug
 */
export function SlugConflictAlert({ conflictsWith }: { conflictsWith: string }) {
  return (
    <Alert.Root status="warning" size="sm" mt={2}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          A dataset named &quot;{conflictsWith}&quot; already uses
          this slug. Please choose a different name.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

