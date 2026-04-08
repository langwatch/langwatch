import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { maskApiKey } from "./shared/api-key-utils";
import { buildMcpConfig } from "./shared/build-mcp-config";
import { InlineCopyButton } from "./shared/InlineCopyButton";
import { JsonHighlight } from "./shared/JsonHighlight";
import { TabButton } from "./shared/TabButton";

const MotionVStack = motion(VStack);

type AppKey = "claude-desktop" | "chatgpt";

const APPS: {
  key: AppKey;
  label: string;
  steps: string[];
}[] = [
  {
    key: "claude-desktop",
    label: "Claude Desktop",
    steps: [
      "Open Settings → Developer → Edit Config",
      "Paste the config into your file",
      "Restart Claude Desktop",
    ],
  },
  {
    key: "chatgpt",
    label: "ChatGPT",
    steps: [
      "Go to Settings → Connectors → Developer mode",
      'Click "Create", name it LangWatch, paste the config',
      "Start a conversation and mention LangWatch",
    ],
  },
];

export function ViaMcpClientScreen(): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeApp, setActiveApp] = useState<AppKey>("claude-desktop");

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;

  const configReady = !!publicEnv.data && !!effectiveApiKey;

  const configJson = useMemo(
    () =>
      configReady
        ? JSON.stringify(
            buildMcpConfig({
              apiKey: effectiveApiKey,
              endpoint: effectiveEndpoint,
            }),
            null,
            2,
          )
        : null,
    [configReady, effectiveApiKey, effectiveEndpoint],
  );

  const maskedApiKey = maskApiKey(effectiveApiKey);

  const displayConfigJson = useMemo(
    () =>
      configReady
        ? JSON.stringify(
            buildMcpConfig({
              apiKey: maskedApiKey,
              endpoint: effectiveEndpoint,
            }),
            null,
            2,
          )
        : null,
    [configReady, maskedApiKey, effectiveEndpoint],
  );

  const currentApp = APPS.find((a) => a.key === activeApp)!;

  return (
    <Grid
      templateColumns={{ base: "1fr", xl: "1fr 1fr" }}
      gap={{ base: 6, xl: 10 }}
      alignItems="start"
    >
      {/* Left */}
      <VStack align="stretch" gap={8} overflow="visible">
        <VStack align="stretch" gap={3}>
          <VStack align="stretch" gap={0.5}>
            <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
              Select your app
            </Text>
            <Text fontSize="xs" color="fg.muted" lineHeight="tall">
              Choose the app you want to connect to LangWatch.
            </Text>
          </VStack>
          <HStack
            gap={1}
            px={1.5}
            py={1.5}
            borderRadius="xl"
            border="1px solid"
            borderColor="border.subtle"
            bg="bg.panel/70"
            backdropFilter="blur(20px) saturate(1.3)"
            boxShadow="0 2px 16px rgba(0,0,0,0.04)"
            w="fit-content"
          >
            {APPS.map((app) => (
              <TabButton
                key={app.key}
                label={app.label}
                active={activeApp === app.key}
                onClick={() => setActiveApp(app.key)}
              />
            ))}
          </HStack>
        </VStack>

        <VStack align="stretch" gap={3}>
          <VStack align="stretch" gap={0.5}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: "6px", fontSize: "var(--chakra-font-sizes-md)", fontWeight: 600, letterSpacing: "-0.01em" }}>
              <span>Connect</span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={currentApp.label}
                  initial={{ opacity: 0, y: 4, filter: "blur(3px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -4, filter: "blur(3px)" }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                >
                  {currentApp.label}
                </motion.span>
              </AnimatePresence>
            </div>
            <Text fontSize="xs" color="fg.muted" lineHeight="tall">
              Follow these steps to get started.
            </Text>
          </VStack>
          <AnimatePresence mode="wait">
            <MotionVStack
              key={activeApp}
              align="stretch"
              gap={3}
              initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -6, filter: "blur(3px)" }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {currentApp.steps.map((step, i) => (
                <HStack
                  key={i}
                  align="center"
                  gap={2.5}
                  px={4}
                  py={2.5}
                  borderRadius="xl"
                  border="1px solid"
                  borderColor="border.subtle"
                  bg="bg.panel/70"
                  backdropFilter="blur(20px) saturate(1.3)"
                  boxShadow="sm"
                  transition="all 0.17s ease"
                  _hover={{
                    borderColor: "border.emphasized",
                    boxShadow: "md",
                    transform: "translateY(-1px)",
                  }}
                >
                  <Box
                    flexShrink={0}
                    w={5}
                    h={5}
                    borderRadius="full"
                    bg="orange.50"
                    color="orange.500"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    fontSize="2xs"
                    fontWeight="bold"
                  >
                    {i + 1}
                  </Box>
                  <Text
                    fontSize="sm"
                    color="fg.DEFAULT"
                    fontWeight="medium"
                    letterSpacing="-0.01em"
                  >
                    {step}
                  </Text>
                </HStack>
              ))}
            </MotionVStack>
          </AnimatePresence>
          <Tooltip
            content="This config also works with Cursor, Windsurf, Claude Code, and any other MCP-compatible client."
            showArrow
            openDelay={0}
          >
            <HStack gap={1.5} color="fg.muted" cursor="default" w="fit-content">
              <Info size={14} />
              <Text fontSize="xs">Compatible with other MCP clients</Text>
            </HStack>
          </Tooltip>
        </VStack>
      </VStack>

      {/* Right */}
      <VStack align="stretch" gap={3} minW={0} w="full">
        <VStack align="stretch" gap={0.5}>
          <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
            Your MCP config
          </Text>
          <Text fontSize="xs" color="fg.muted" lineHeight="tall">
            Pre-filled with your project API key. Copy and paste it into your
            app.
          </Text>
        </VStack>

        <Box
          position="relative"
          borderRadius="xl"
          overflow="hidden"
          border="1px solid"
          borderColor="border.subtle"
          bg="bg.panel/70"
          backdropFilter="blur(20px) saturate(1.3)"
          boxShadow="sm"
          transition="all 0.17s ease"
          _hover={{
            borderColor: "orange.emphasized",
            boxShadow: "md",
          }}
        >
          <JsonHighlight code={displayConfigJson ?? "Loading config…"} />
          {configJson && (
            <Box position="absolute" top={2.5} right={2.5}>
              <InlineCopyButton text={configJson} label="Config" />
            </Box>
          )}
        </Box>
      </VStack>
    </Grid>
  );
}
