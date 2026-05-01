import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import { CodePreview } from "./observability/CodePreview";
import {
  buildMcpJson,
  findLangwatchEnvLines,
} from "./shared/build-mcp-config";
import { TabButton } from "./shared/TabButton";

const MotionVStack = motion.create(VStack);

type AppKey = "claude-desktop" | "codex" | "gemini";

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
    key: "codex",
    label: "Codex",
    steps: [
      "Open ~/.codex/config.toml (or create it)",
      "Paste the LangWatch MCP server entry into [mcp_servers]",
      "Restart Codex",
    ],
  },
  {
    key: "gemini",
    label: "Gemini",
    steps: [
      "Run gemini mcp add langwatch -- npx -y @langwatch/mcp-server",
      "Set the LANGWATCH_API_KEY / LANGWATCH_PROJECT_ID env vars",
      "Restart your Gemini session",
    ],
  },
];

export function ViaMcpClientScreen(): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeApp, setActiveApp] = useState<AppKey>("claude-desktop");

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;
  const effectiveProjectId = project?.id;

  const configReady = !!publicEnv.data && !!effectiveApiKey;

  const configJson = useMemo(
    () =>
      configReady
        ? buildMcpJson({
            apiKey: effectiveApiKey,
            endpoint: effectiveEndpoint,
            projectId: effectiveProjectId,
          })
        : null,
    [configReady, effectiveApiKey, effectiveEndpoint, effectiveProjectId],
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
            boxShadow="sm"
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
                    bg="orange.subtle"
                    color="orange.fg"
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
                    color="fg"
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
        {/*
         * Same `CodePreview` the Manually tab uses for SDK code — keeps
         * MCP/manual surfaces visually consistent (border, copy button,
         * sensitive-value masking + reveal, line highlighting all share
         * the same shiki adapter and recipe). The `sensitiveValue` toggle
         * lets users reveal the API key in place rather than us
         * pre-masking the displayed JSON.
         */}
        <CodePreview
          code={configJson ?? "Loading config…"}
          filename="mcp.json"
          codeLanguage="json"
          highlightLines={
            configJson ? findLangwatchEnvLines(configJson) : undefined
          }
          sensitiveValue={effectiveApiKey || undefined}
          enableVisibilityToggle={!!effectiveApiKey}
        />
      </VStack>
    </Grid>
  );
}
