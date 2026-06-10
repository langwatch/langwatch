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
  CLOUD_ENDPOINT,
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

/**
 * Placeholder rendered in the config JSON before a fresh token is
 * available. Matches the shape of the real `sk-lw-...` token so the
 * config reads as "a key would go here" rather than "this is broken".
 * The x's are obviously fake — combined with the empty-state overlay
 * on the code block, the user can't accidentally copy this value out
 * because the surrounding chrome (copy button, reveal toggle) is
 * suppressed until a real token has been minted.
 */
const PLACEHOLDER_API_KEY = "sk-lw-xxxxxxxxxxxxxxxxxxxxxxxx";

export function ViaMcpClientScreen(): React.ReactElement {
  const { project, freshToken } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeApp, setActiveApp] = useState<AppKey>("claude-desktop");

  const effectiveEndpoint = publicEnv.data?.BASE_HOST;
  const effectiveProjectId = project?.id;

  // Only use a freshly-minted token. If none has been minted this session,
  // the config renders behind the empty-state overlay (driven by the
  // canonical Generate CTA on the .env card above) — we don't mint from
  // here so there's a single, unambiguous "Generate access token" surface.
  const tokenForConfig = freshToken ?? null;
  const hasToken = !!tokenForConfig;

  const configJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: tokenForConfig ?? PLACEHOLDER_API_KEY,
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
            {hasToken
              ? "Pre-filled with your API key. Copy and paste into your app."
              : "We'll fill in the API key once you generate one."}
          </Text>
        </VStack>

        <CodePreview
          code={configJson}
          filename="mcp.json"
          codeLanguage="json"
          highlightLines={
            hasToken ? findLangwatchEnvLines(configJson) : []
          }
          sensitiveValue={tokenForConfig ?? undefined}
          enableVisibilityToggle={hasToken}
          disableActions={!hasToken}
        />
      </VStack>
    </Grid>
  );
}
