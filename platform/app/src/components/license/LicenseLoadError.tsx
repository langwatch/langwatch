import { Box, Button, Text, VStack } from "@chakra-ui/react";

/**
 * Shown when the license status could not be fetched. Distinct from having no
 * license: we do not know either way here, so it offers a retry rather than an
 * activation form.
 */
export function LicenseLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Box borderWidth="1px" borderRadius="lg" padding={6} width="full">
      <VStack align="start" gap={4}>
        <Text fontWeight="medium">Unable to load license</Text>
        <Text color="fg.muted">
          Your license status could not be retrieved. Please try again or
          contact support if the issue persists.
        </Text>
        <Button onClick={onRetry} size="sm">
          Retry
        </Button>
      </VStack>
    </Box>
  );
}
