import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import {
  API_KEY_PLACEHOLDER,
  PersonalAccessTokenBanner,
} from "@langwatch/design-system/personal-access-token-banner";
import { Box, Grid, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";

import {
  buildMcpJson,
  findLangwatchEnvLines,
} from "../../../model/onboarding/shared/build-mcp-config.ts";
import { TabButton } from "../../elements/onboarding/shared/tab-button.tsx";
import { showErrorToast } from "../errors/index.ts";
import { useActiveProject } from "./active-project-context.tsx";
import { CodePreview } from "./observability/code-preview.tsx";

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
  // The MCP config takes its own project-reads token, never the `.env` ingestion one.
  const { project, mcpMinting } = useActiveProject();
  const { appBaseUrl } = useUiDeployment();
  const [activeApp, setActiveApp] = useState<AppKey>("claude-desktop");

  const effectiveEndpoint = appBaseUrl;
  const effectiveProjectId = project?.id;

  // Only a token created this session fills the config; until then it shows a placeholder.
  const tokenForConfig = mcpMinting?.token ?? null;
  const hasToken = !!tokenForConfig;

  const configJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: tokenForConfig ?? API_KEY_PLACEHOLDER,
        endpoint: effectiveEndpoint,
        projectId: effectiveProjectId,
      }),
    [tokenForConfig, effectiveEndpoint, effectiveProjectId],
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
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "baseline",
                gap: "6px",
                fontSize: "var(--chakra-font-sizes-md)",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
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
                  boxShadow="sm"
                  // No hover affordance — these are static instruction
                  // cards, not clickable. The previous lift/shadow read
                  // as "I can press this" which the user can't, so it
                  // felt broken on interaction.
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
                  <Text fontSize="sm" color="fg" fontWeight="medium" letterSpacing="-0.01em">
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
            {hasToken
              ? "Pre-filled with your personal access token. Copy and paste into your app."
              : "We'll fill in the API key once you create a key."}
          </Text>
        </VStack>

        {mcpMinting ? (
          <PersonalAccessTokenBanner
            token={tokenForConfig}
            isCreating={mcpMinting.isMinting}
            onCreate={() => {
              mcpMinting
                .mint()
                .catch((error: unknown) =>
                  showErrorToast({ error, fallbackTitle: "Couldn't create the MCP access token" }),
                );
            }}
            scopeNote={mcpMinting.scopeNote}
            createLabel="Create a key"
          />
        ) : null}

        <CodePreview
          code={configJson}
          filename="mcp.json"
          codeLanguage="json"
          highlightLines={hasToken ? findLangwatchEnvLines(configJson) : []}
          sensitiveValue={tokenForConfig ?? undefined}
          enableVisibilityToggle={hasToken}
          disableActions={!hasToken}
        />
      </VStack>
    </Grid>
  );
}
