import { Alert } from "@chakra-ui/react";

/**
 * Alert component for warning about slug changes breaking external references.
 *
 * Single Responsibility: Displays a warning that changing the slug will break external references.
 */
export function SlugChangeWarningAlert() {
  return (
    <Alert.Root status="warning" size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          Warning: this will break external references to this dataset. Please update your references to the new slug after saving.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

