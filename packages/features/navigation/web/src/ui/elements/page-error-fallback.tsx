import { Box, Button, Center, Code, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, Check, Copy, Home, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useNavigationHost } from "../../model/navigation-host";

/**
 * What a page that threw is replaced with.
 *
 * Moved from `platform/app/src/components/ui/PageErrorFallback.tsx`. Two
 * things did not travel: the PostHog capture, because product analytics is the
 * application's and `platform/app/src/utils/posthogErrorCapture` is one of its
 * modules; and `process.env.NODE_ENV`, which a browser does not have and a
 * governed web package may not name — the host's deployment reading says
 * whether this is a development build.
 */
export function PageErrorFallback({
  error,
  resetErrorBoundary,
}: {
  error: unknown;
  resetErrorBoundary: (...args: unknown[]) => void;
}) {
  const host = useNavigationHost();
  const [copied, setCopied] = useState(false);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : void 0;
  const isDev = host.deployment().isDevelopment;

  return (
    <Center minHeight="60vh" padding={8}>
      <VStack gap={6} maxWidth="560px" width="full">
        <VStack gap={3}>
          <Box padding={3} borderRadius="full" bg="red.500/10">
            <AlertTriangle size={28} color="var(--chakra-colors-red-400)" />
          </Box>
          <Heading size="md" color="fg.default">
            Something went wrong
          </Heading>
          <Text textStyle="sm" color="fg.muted" textAlign="center" maxWidth="400px">
            Sorry about that — our team has been notified and is looking into it. You can try again,
            or head back to the home page.
          </Text>
        </VStack>

        {isDev ? (
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
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(stack ?? message);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    // Clipboard API unavailable or denied
                  }
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
              {stack ?? message}
            </Code>
          </Box>
        ) : (
          <Text textStyle="sm" color="fg.muted" textAlign="center">
            Error reference has been logged automatically.
          </Text>
        )}

        <HStack gap={3}>
          <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
            <RotateCcw size={14} />
            Try again
          </Button>
          <Button size="sm" variant="ghost" color="fg.muted" onClick={() => host.navigate("/")}>
            <Home size={14} />
            Home
          </Button>
        </HStack>
      </VStack>
    </Center>
  );
}
