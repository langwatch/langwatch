import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Clipboard, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";

const MotionVStack = motion(VStack);
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { toaster } from "../../../../components/ui/toaster";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import {
  PROMPT_ANALYTICS,
  PROMPT_EVALUATIONS,
  PROMPT_LEVEL_UP,
  PROMPT_PROMPTS,
  PROMPT_SCENARIOS,
  PROMPT_TRACING,
} from "./code-prompts";

const CLOUD_ENDPOINT = "https://app.langwatch.ai";

type TabKey = "prompt" | "skill" | "mcp";

interface SkillItem {
  id: string;
  label: string;
  prompt: string;
  installCommand: string;
  slashCommand: string;
  highlight?: boolean;
}

const SKILLS: SkillItem[] = [
  {
    id: "level-up",
    label: "Level up with everything LangWatch",
    prompt: PROMPT_LEVEL_UP,
    installCommand: "npx skills add langwatch/skills/level-up",
    slashCommand: "/level-up",
    highlight: true,
  },
  {
    id: "evaluations",
    label: "Set up evaluations for your agent",
    prompt: PROMPT_EVALUATIONS,
    installCommand: "npx skills add langwatch/skills/evaluations",
    slashCommand: "/evaluations",
  },
  {
    id: "scenarios",
    label: "Test your agent with scenarios",
    prompt: PROMPT_SCENARIOS,
    installCommand: "npx skills add langwatch/skills/scenarios",
    slashCommand: "/scenarios",
  },
  {
    id: "tracing",
    label: "Add LangWatch tracing to your code",
    prompt: PROMPT_TRACING,
    installCommand: "npx skills add langwatch/skills/tracing",
    slashCommand: "/tracing",
  },
  {
    id: "prompts",
    label: "Version your prompts with LangWatch",
    prompt: PROMPT_PROMPTS,
    installCommand: "npx skills add langwatch/skills/prompts",
    slashCommand: "/prompts",
  },
  {
    id: "analytics",
    label: "Analyze agent performance with LangWatch",
    prompt: PROMPT_ANALYTICS,
    installCommand: "npx skills add langwatch/skills/analytics",
    slashCommand: "/analytics",
  },
];

interface EditorPath {
  editor: string;
  path: string;
}

const EDITOR_PATHS: EditorPath[] = [
  { editor: "Claude Code", path: ".claude/settings.json" },
  { editor: "Cursor", path: ".cursor/mcp.json" },
  { editor: "Copilot", path: ".vscode/mcp.json" },
  { editor: "Windsurf", path: "~/.codeium/windsurf/mcp_config.json" },
  {
    editor: "Claude Desktop",
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
  },
];

function buildMcpJson({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string | undefined;
}): string {
  const env: Record<string, string> = {
    LANGWATCH_API_KEY: apiKey,
  };

  if (endpoint && endpoint !== CLOUD_ENDPOINT) {
    env.LANGWATCH_ENDPOINT = endpoint;
  }

  return JSON.stringify(
    {
      mcpServers: {
        langwatch: {
          command: "npx",
          args: ["-y", "@langwatch/mcp-server"],
          env,
        },
      },
    },
    null,
    2,
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
      transition="all 0.2s ease"
      _hover={{
        bg: active ? "white" : "gray.50",
      }}
      letterSpacing="-0.01em"
    >
      {label}
    </Button>
  );
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

function glassCard({
  highlight,
}: {
  highlight?: boolean;
}): Record<string, unknown> {
  return {
    borderRadius: "xl",
    border: "1px solid",
    borderColor: highlight ? "orange.200" : "gray.200",
    bg: highlight ? "orange.50" : "white/70",
    backdropFilter: "blur(20px) saturate(1.3)",
    boxShadow: highlight
      ? "0 0 0 1px rgba(237,137,38,0.08), 0 4px 24px rgba(237,137,38,0.12), inset 0 1px 0 white"
      : "0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 white",
    transition: "all 0.17s ease",
    _hover: {
      borderColor: highlight ? "orange.300" : "gray.300",
      boxShadow: highlight
        ? "0 0 0 1px rgba(237,137,38,0.12), 0 8px 32px rgba(237,137,38,0.18), inset 0 1px 0 white"
        : "0 6px 28px rgba(0,0,0,0.07), inset 0 1px 0 white",
      transform: "translateY(-1px)",
    },
  };
}

function PromptRow({
  skill,
}: {
  skill: SkillItem;
}): React.ReactElement {
  return (
    <HStack
      justify="space-between"
      align="center"
      px={5}
      py={3.5}
      gap={4}
      {...glassCard({ highlight: skill.highlight })}
    >
      <Text
        fontSize="sm"
        color="fg.DEFAULT"
        fontWeight={skill.highlight ? "semibold" : "medium"}
        letterSpacing="-0.01em"
      >
        {skill.label}
      </Text>
      <InlineCopyButton text={skill.prompt} label="Prompt" />
    </HStack>
  );
}

function SkillRow({
  skill,
}: {
  skill: SkillItem;
}): React.ReactElement {
  return (
    <VStack
      align="stretch"
      px={5}
      py={4}
      gap={3}
      {...glassCard({ highlight: skill.highlight })}
    >
      <Text
        fontSize="sm"
        color="fg.DEFAULT"
        fontWeight={skill.highlight ? "semibold" : "medium"}
        letterSpacing="-0.01em"
      >
        {skill.label}
      </Text>
      <HStack gap={2} align="center">
        <Terminal size={12} color="var(--chakra-colors-fg-muted)" />
        <Text fontSize="xs" fontFamily="mono" color="fg.muted" flex={1}>
          {skill.installCommand}
        </Text>
        <InlineCopyButton text={skill.installCommand} label="Command" />
      </HStack>
      <HStack
        gap={2}
        align="center"
        px={3}
        py={2}
        borderRadius="lg"
        bg="white/60"
        border="1px solid"
        borderColor="gray.200"
      >
        <Text fontSize="xs" color="fg.muted">
          Then use
        </Text>
        <HStack
          asChild
          gap={0.5}
          align="center"
          cursor="pointer"
          _hover={{ opacity: 0.7 }}
          transition="opacity 0.15s ease"
        >
          <button
            type="button"
            aria-label={`Copy ${skill.slashCommand}`}
            onClick={() => {
              void navigator.clipboard
                .writeText(skill.slashCommand)
                .then(() => {
                  toaster.create({
                    title: "Copied",
                    description: `${skill.slashCommand} copied to clipboard`,
                    type: "success",
                    meta: { closable: true },
                  });
                })
                .catch(() => {
                  toaster.create({
                    title: "Failed to copy",
                    type: "error",
                    meta: { closable: true },
                  });
                });
            }}
          >
            <Text
              fontSize="xs"
              fontFamily="mono"
              fontWeight="semibold"
              color="orange.400"
            >
              {skill.slashCommand}
            </Text>
            <Clipboard size={10} color="var(--chakra-colors-orange-300)" />
          </button>
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          in your coding agent
        </Text>
      </HStack>
    </VStack>
  );
}

function QuickCommand({
  label,
  displayCommand,
  copyCommand,
}: {
  label: string;
  displayCommand: string;
  copyCommand: string;
}): React.ReactElement {
  return (
    <HStack
      justify="space-between"
      align="center"
      px={4}
      py={3}
      {...glassCard({ highlight: false })}
    >
      <HStack gap={2.5} align="center" minW={0}>
        <Box flexShrink={0} display="flex" alignItems="center">
          <Terminal size={13} color="var(--chakra-colors-fg-muted)" />
        </Box>
        <VStack align="start" gap={0} minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.DEFAULT">
            {label}
          </Text>
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" wordBreak="break-all">
            {displayCommand}
          </Text>
        </VStack>
      </HStack>
      <InlineCopyButton text={copyCommand} label="Command" />
    </HStack>
  );
}

function McpTab({
  mcpJson,
  displayConfigJson,
  apiKey,
  maskedKey,
  endpoint,
}: {
  mcpJson: string;
  displayConfigJson: string;
  apiKey: string;
  maskedKey: string;
  endpoint: string | undefined;
}): React.ReactElement {
  const isSelfHosted = endpoint && endpoint !== CLOUD_ENDPOINT;
  const endpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";
  const maskedEndpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";

  return (
    <VStack align="stretch" gap={4}>
      {/* Quick shortcuts */}
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.DEFAULT">
          Quick setup
        </Text>
        <QuickCommand
          label="Claude Code"
          displayCommand={`claude mcp add langwatch -- npx -y @langwatch/mcp-server --api-key ${maskedKey}${maskedEndpointFlag}`}
          copyCommand={`claude mcp add langwatch -- npx -y @langwatch/mcp-server --api-key ${apiKey}${endpointFlag}`}
        />
        <QuickCommand
          label="OpenAI Codex"
          displayCommand={`codex --mcp-server "npx -y @langwatch/mcp-server --api-key ${maskedKey}${maskedEndpointFlag}"`}
          copyCommand={`codex --mcp-server "npx -y @langwatch/mcp-server --api-key ${apiKey}${endpointFlag}"`}
        />
      </VStack>

      {/* JSON config */}
      <Text fontSize="xs" fontWeight="semibold" color="fg.DEFAULT">
        Or paste into your config file
      </Text>
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
          {displayConfigJson}
        </Box>
        <Box position="absolute" top={2.5} right={2.5}>
          <InlineCopyButton text={mcpJson} label="Config" />
        </Box>
      </Box>

      {/* Where to paste — compact inline chips */}
      <HStack gap={2} flexWrap="wrap" align="center">
        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
          Config path:
        </Text>
        {EDITOR_PATHS.map((ep) => (
          <Tooltip key={ep.editor} content={`Click to copy: ${ep.path}`} showArrow openDelay={0}>
            <HStack
              asChild
              gap={1}
              px={2.5}
              py={1}
              borderRadius="md"
              bg="white/60"
              border="1px solid"
              borderColor="gray.200"
              cursor="pointer"
              transition="all 0.15s ease"
              _hover={{ borderColor: "rgba(237,137,38,0.25)", bg: "white" }}
              onClick={() => {
                void navigator.clipboard
                  .writeText(ep.path)
                  .then(() => {
                    toaster.create({
                      title: "Copied",
                      description: `${ep.editor} config path copied`,
                      type: "success",
                      meta: { closable: true },
                    });
                  })
                  .catch(() => {
                    toaster.create({
                      title: "Failed to copy",
                      type: "error",
                      meta: { closable: true },
                    });
                  });
              }}
            >
              <button type="button" aria-label={`Copy ${ep.editor} config path`}>
                <Text fontSize="2xs" fontWeight="medium" color="fg.DEFAULT">
                  {ep.editor}
                </Text>
                <Clipboard size={9} color="var(--chakra-colors-gray-400)" />
              </button>
            </HStack>
          </Tooltip>
        ))}
      </HStack>
    </VStack>
  );
}

export function ViaClaudeCodeScreen(): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeTab, setActiveTab] = useState<TabKey>("prompt");

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;

  const maskedApiKey = effectiveApiKey
    ? `${effectiveApiKey.slice(0, 6)}•••${effectiveApiKey.slice(-4)}`
    : "";

  const mcpJson = useMemo(
    () =>
      buildMcpJson({ apiKey: effectiveApiKey, endpoint: effectiveEndpoint }),
    [effectiveApiKey, effectiveEndpoint],
  );

  const displayConfigJson = useMemo(
    () =>
      buildMcpJson({ apiKey: maskedApiKey, endpoint: effectiveEndpoint }),
    [maskedApiKey, effectiveEndpoint],
  );

  return (
    <>
      <VStack align="stretch" gap={4} mb={20} w="640px" maxW="100%" mx="auto">
        <HStack
          justify="center"
          gap={1}
          mx="auto"
          px={1.5}
          py={1.5}
          borderRadius="xl"
          border="1px solid"
          borderColor="gray.200"
          bg="white/70"
          backdropFilter="blur(20px) saturate(1.3)"
          boxShadow="0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 white"
        >
          <TabButton
            label="Prompt"
            active={activeTab === "prompt"}
            onClick={() => setActiveTab("prompt")}
          />
          <TabButton
            label="Skill"
            active={activeTab === "skill"}
            onClick={() => setActiveTab("skill")}
          />
          <TabButton
            label="MCP"
            active={activeTab === "mcp"}
            onClick={() => setActiveTab("mcp")}
          />
        </HStack>

        {/* Description — stays fixed, only text swaps */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {activeTab === "prompt" && (
              <Text fontSize="sm" color="fg.DEFAULT/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg.DEFAULT">
                  Zero setup.
                </Text>{" "}
                Copy a prompt, paste it into your coding agent, and it handles
                everything from there.
              </Text>
            )}
            {activeTab === "skill" && (
              <Text fontSize="sm" color="fg.DEFAULT/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg.DEFAULT">
                  Install once, reuse anytime.
                </Text>{" "}
                Run the install command, then type{" "}
                <Text as="span" fontFamily="mono" fontWeight="semibold" color="orange.400">
                  /command
                </Text>{" "}
                in your coding agent whenever you need it.
              </Text>
            )}
            {activeTab === "mcp" && (
              <Text fontSize="sm" color="fg.DEFAULT/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg.DEFAULT">
                  Live connection.
                </Text>{" "}
                Give your agent direct access to your LangWatch dashboard.
              </Text>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Tab content — only the items animate, no y movement to avoid container resize */}
        <AnimatePresence mode="wait" initial={false}>
          <MotionVStack
            key={activeTab}
            align="stretch"
            gap={activeTab === "mcp" ? 0 : 4}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {activeTab === "prompt" &&
              SKILLS.map((skill) => (
                <PromptRow key={skill.id} skill={skill} />
              ))}
            {activeTab === "skill" &&
              SKILLS.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            {activeTab === "mcp" && (
              <McpTab mcpJson={mcpJson} displayConfigJson={displayConfigJson} apiKey={effectiveApiKey} maskedKey={maskedApiKey} endpoint={effectiveEndpoint} />
            )}
          </MotionVStack>
        </AnimatePresence>
      </VStack>

    </>
  );
}
