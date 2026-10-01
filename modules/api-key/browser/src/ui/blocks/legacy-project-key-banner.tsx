import { Alert } from "@langwatch/design-system/primitives";

/** Tells an admin that the project's legacy key is on its way out. */
export function LegacyProjectKeyBanner() {
  return (
    <Alert.Root status="warning" data-testid="legacy-project-key-banner">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Legacy project keys are going away</Alert.Title>
        <Alert.Description>Use personal access tokens instead.</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
