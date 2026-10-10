import { Alert, Button } from "@langwatch/design-system/primitives";

/**
 * Shown when the license status could not be fetched. Distinct from having no
 * license: we do not know either way here, so it offers a retry rather than an
 * activation form.
 */
export function LicenseLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Unable to load license</Alert.Title>
        <Alert.Description>
          Your license status could not be retrieved. Please try again or contact support if the
          issue persists.
        </Alert.Description>
      </Alert.Content>
      <Button size="sm" variant="outline" colorPalette="orange" onClick={onRetry}>
        Retry
      </Button>
    </Alert.Root>
  );
}
