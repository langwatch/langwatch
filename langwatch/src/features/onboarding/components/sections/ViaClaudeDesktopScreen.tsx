import { Box, Button, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Clipboard, Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { toaster } from "../../../../components/ui/toaster";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

const MotionVStack = motion(VStack);

const CLOUD_ENDPOINT = "https://app.langwatch.ai";

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

function buildMcpConfig({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string | undefined;
}): object {
  const env: Record<string, string> = {
    LANGWATCH_API_KEY: apiKey,
  };
  if (endpoint && endpoint !== CLOUD_ENDPOINT) {
    env.LANGWATCH_ENDPOINT = endpoint;
  }
  return {
    mcpServers: {
      langwatch: {
        command: "npx",
        args: ["-y", "@langwatch/mcp-server"],
        env,
      },
    },
  };
}

function InlineCopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toaster.create({
        title: "Copied",
        description: `${label} copied to clipboard`,
        type: "success",
        meta: { closable: true },
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy. Please try again.",
        type: "error",
        meta: { closable: true },
      });
    }
  }

  return (
    <Tooltip
      content={copied ? "Copied!" : `Copy ${label.toLowerCase()}`}
      openDelay={0}
      showArrow
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void handleCopy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        colorPalette={copied ? "green" : "gray"}
        backdropFilter="blur(8px)"
        bg="white/50"
        borderRadius="lg"
        _hover={{ bg: "white/70" }}
        flexShrink={0}
        gap={1.5}
      >
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </Button>
    </Tooltip>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      borderRadius="lg"
      px={5}
      py={1.5}
      fontSize="sm"
      fontWeight={active ? "semibold" : "medium"}
      color={active ? "fg.DEFAULT" : "fg.muted"}
      bg={active ? "white" : "transparent"}
      backdropFilter={active ? "blur(20px) saturate(1.3)" : undefined}
      boxShadow={
        active
          ? "0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 white"
          : undefined
      }
      border="1px solid"
      borderColor={active ? "gray.200" : "transparent"}
      transition="all 0.17s ease"
      _hover={{ bg: active ? "white" : "gray.50" }}
      letterSpacing="-0.01em"
    >
      {label}
    </Button>
  );
}

export function ViaClaudeDesktopScreen(): React.ReactElement {
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

  const maskedApiKey = effectiveApiKey
    ? `${effectiveApiKey.slice(0, 6)}•••••${effectiveApiKey.slice(-4)}`
    : "";

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
            borderColor="gray.200"
            bg="white/70"
            backdropFilter="blur(20px) saturate(1.3)"
            boxShadow="0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 white"
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
                  borderColor="gray.200"
                  bg="white/70"
                  backdropFilter="blur(20px) saturate(1.3)"
                  boxShadow="0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 white"
                  transition="all 0.17s ease"
                  _hover={{
                    borderColor: "gray.300",
                    boxShadow:
                      "0 6px 28px rgba(0,0,0,0.07), inset 0 1px 0 white",
                    transform: "translateY(-1px)",
                  }}
                >
                  <Box
                    flexShrink={0}
                    w={5}
                    h={5}
                    borderRadius="full"
                    bg="rgba(237,137,38,0.10)"
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
          borderColor="gray.200"
          bg="white/70"
          backdropFilter="blur(20px) saturate(1.3)"
          boxShadow="0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 white"
          transition="all 0.17s ease"
          _hover={{
            borderColor: "rgba(237,137,38,0.25)",
            boxShadow: "0 6px 28px rgba(237,137,38,0.06), inset 0 1px 0 white",
          }}
        >
          <Box
            as="pre"
            px={5}
            py={4}
            pr={12}
            fontSize="12.5px"
            fontFamily="'Geist Mono', 'IBM Plex Mono', 'Source Code Pro', Menlo, monospace"
            color="gray.800"
            lineHeight="1.8"
            overflowX="hidden"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
            letterSpacing="0.01em"
            fontWeight="500"
          >
            {displayConfigJson ?? "Loading config…"}
          </Box>
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
