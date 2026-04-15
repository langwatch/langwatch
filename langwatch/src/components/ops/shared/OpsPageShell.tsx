import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Center,
  Code,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import { ErrorBoundary } from "react-error-boundary";
import { AlertTriangle, Copy, Check, RotateCcw, Home } from "lucide-react";
import { useOpsPermission } from "~/hooks/useOpsPermission";

function OpsErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: (...args: unknown[]) => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const message =
    error instanceof Error ? error.message : String(error);
  const stack =
    error instanceof Error ? error.stack : undefined;

  return (
    <Center minHeight="60vh" padding={8}>
      <VStack gap={6} maxWidth="560px" width="full">
        <VStack gap={3}>
          <Box
            padding={3}
            borderRadius="full"
            bg="red.500/10"
          >
            <AlertTriangle size={28} color="var(--chakra-colors-red-400)" />
          </Box>
          <Heading size="md" color="fg.default">
            Something went wrong
          </Heading>
          <Text
            textStyle="sm"
            color="fg.muted"
            textAlign="center"
            maxWidth="400px"
          >
            An error occurred in the ops UI. The rest of the platform is
            unaffected.
          </Text>
        </VStack>

        <Box
          width="full"
          borderRadius="lg"
          border="1px solid"
          borderColor="border"
          overflow="hidden"
        >
          <HStack
            paddingX={4}
            paddingY={2.5}
            bg="bg.subtle"
            borderBottom="1px solid"
            borderColor="border"
            justify="space-between"
          >
            <Text textStyle="xs" fontWeight="medium" color="fg.muted">
              Error details
            </Text>
            <Button
              size="2xs"
              variant="ghost"
              color="fg.muted"
              onClick={() => {
                const text = stack ?? message;
                void navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </HStack>
          <Code
            display="block"
            paddingX={4}
            paddingY={3}
            maxHeight="180px"
            overflow="auto"
            textStyle="xs"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            bg="bg.panel"
            color="red.400"
            borderRadius={0}
          >
            {message}
          </Code>
        </Box>

        <HStack gap={3}>
          <Button
            size="sm"
            variant="outline"
            onClick={resetErrorBoundary}
          >
            <RotateCcw size={14} />
            Try again
          </Button>
          <Button
            size="sm"
            variant="ghost"
            color="fg.muted"
            onClick={() => void router.push("/ops")}
          >
            <Home size={14} />
            Back to Ops
          </Button>
        </HStack>
      </VStack>
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
