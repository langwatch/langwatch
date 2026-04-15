import { useEffect } from "react";
import { Box, Button, Card, Center, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { ErrorBoundary } from "react-error-boundary";
import { useOpsPermission } from "~/hooks/useOpsPermission";

function OpsErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: (...args: unknown[]) => void;
}) {
  return (
    <Center paddingY={20}>
      <Card.Root maxWidth="480px" borderColor="red.200" borderWidth="1px">
        <Card.Body padding={6}>
          <VStack gap={3} align="stretch">
            <Text textStyle="sm" fontWeight="semibold" color="red.500">
              Ops component error
            </Text>
            <Text textStyle="xs" color="fg.muted">
              An error occurred in the ops UI. This does not affect the rest of
              the platform.
            </Text>
            <Box
              bg="red.subtle"
              padding={3}
              borderRadius="md"
              maxHeight="120px"
              overflow="auto"
            >
              <Text
                textStyle="xs"
                fontFamily="mono"
                color="red.500"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {error instanceof Error ? error.message : String(error)}
              </Text>
            </Box>
            <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
              Try again
            </Button>
          </VStack>
        </Card.Body>
      </Card.Root>
    </Center>
  );
}

export function OpsPageShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, isLoading, router]);

  if (isLoading || !hasAccess) return null;

  return (
    <ErrorBoundary FallbackComponent={OpsErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}
