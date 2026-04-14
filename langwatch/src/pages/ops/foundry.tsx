import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Button, HStack, Center, Text, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { PlaygroundContent } from "~/components/ops/foundry/PlaygroundContent";
import { PresetPicker } from "~/components/ops/foundry/PresetPicker";
import { useTraceStore } from "~/components/ops/foundry/traceStore";

const SPLASH_LINES = [
  "Warming up the flux capacitor...",
  "Calibrating span generators...",
  "Untangling distributed traces...",
  "Teaching spans about their parents...",
  "Inflating token counts for drama...",
  "Reticulating splines (the OTel ones)...",
  "Asking the LLM to be patient...",
];

function Splash() {
  const [line] = useState(
    () => SPLASH_LINES[Math.floor(Math.random() * SPLASH_LINES.length)]!
  );

  return (
    <Center h="full">
      <VStack gap={3}>
        <Text fontSize="lg" fontWeight="semibold" color="gray.300">
          The Foundry
        </Text>
        <Text fontSize="sm" color="gray.500" fontStyle="italic">
          {line}
        </Text>
      </VStack>
    </Center>
  );
}

export default function OpsFoundryPage() {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();
  const resetTrace = useTraceStore((s) => s.resetTrace);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, isLoading, router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (isLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <Flex align="center" justify="space-between" w="full">
          <PageLayout.Heading>The Foundry</PageLayout.Heading>
          <HStack gap={2}>
            <PresetPicker />
            <Button size="xs" variant="outline" onClick={resetTrace}>
              <RotateCcw size={14} />
              Reset
            </Button>
          </HStack>
        </Flex>
      </PageLayout.Header>
      <Box height="calc(100vh - 56px - 48px)" w="full" overflow="hidden" borderTopLeftRadius="inherit">
        {mounted ? <PlaygroundContent /> : <Splash />}
      </Box>
    </DashboardLayout>
  );
}
