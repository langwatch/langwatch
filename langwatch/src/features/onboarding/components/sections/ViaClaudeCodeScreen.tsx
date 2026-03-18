import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Clipboard, Terminal } from "lucide-react";
import { useRouter } from "next/router";
import type React from "react";
import { useMemo, useState } from "react";
import { ArrowRight } from "react-feather";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { toaster } from "../../../../components/ui/toaster";
import { useActiveProject } from "../../contexts/ActiveProjectContext";

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
    id: "tracing",
    label: "Instrument my agent with open telemetry",
    prompt:
      "Instrument my code with LangWatch tracing. Read the codebase to understand the agent's architecture, install the LangWatch SDK, add comprehensive tracing across all LLM call sites, and verify traces appear in the dashboard.",
    installCommand: "npx skills add langwatch/skills/tracing",
    slashCommand: "/langwatch-tracing",
  },
  {
    id: "evaluations",
    label: "Write evaluations for my agent",
    prompt:
      "Set up evaluations for my agent with LangWatch. Create 1-2 high-quality experiments with domain-realistic data, configure online evaluation for production monitoring, and set up evaluators for quality and safety scoring.",
    installCommand: "npx skills add langwatch/skills/evaluations",
    slashCommand: "/langwatch-evaluations",
  },
  {
    id: "scenarios",
    label: "Write scenario tests and a CI pipeline for my agent",
    prompt:
      "Add scenario tests for my agent using the @langwatch/scenario SDK. Read the codebase, write simulation tests covering key user journeys, set up a CI pipeline to run them automatically, and include red teaming with RedTeamAgent.",
    installCommand: "npx skills add langwatch/skills/scenarios",
    slashCommand: "/langwatch-scenarios",
  },
  {
    id: "prompts",
    label: "Version my prompts",
    prompt:
      "Version my prompts with LangWatch. Use langwatch.prompts.get() to fetch managed prompts, initialize with CLI, create managed prompts, and sync to the platform. Do not duplicate prompt text as a fallback.",
    installCommand: "npx skills add langwatch/skills/prompts",
    slashCommand: "/langwatch-prompts",
  },
  {
    id: "level-up",
    label: "Do all of the above",
    prompt:
      "Take my agent to the next level with LangWatch. Set up tracing, version my prompts, create evaluations, and add scenario tests — all in one go. Read the codebase first, then deliver each capability incrementally.",
    installCommand: "npx skills add langwatch/skills/level-up",
    slashCommand: "/langwatch-level-up",
    highlight: true,
  },
];

interface EditorPath {
  editor: string;
  path: string;
}

const EDITOR_PATHS: EditorPath[] = [
  { editor: "Claude Code", path: ".claude/settings.json" },
  { editor: "Cursor", path: ".cursor/mcp.json" },
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
    transition: "all 0.2s ease",
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
      <HStack justify="space-between" align="center" gap={4}>
        <Text
          fontSize="sm"
          color="fg.DEFAULT"
          fontWeight={skill.highlight ? "semibold" : "medium"}
          letterSpacing="-0.01em"
        >
          {skill.label}
        </Text>
        <InlineCopyButton text={skill.installCommand} label="Command" />
      </HStack>
      <HStack gap={2} align="center">
        <Terminal size={12} color="var(--chakra-colors-fg-muted)" />
        <Text fontSize="xs" fontFamily="mono" color="fg.muted">
          {skill.installCommand}
        </Text>
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
        <Text
          fontSize="xs"
          fontFamily="mono"
          fontWeight="semibold"
          color="orange.400"
        >
          {skill.slashCommand}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          in your coding agent
        </Text>
      </HStack>
    </VStack>
  );
}

function McpTab({
  mcpJson,
}: {
  mcpJson: string;
}): React.ReactElement {
  return (
    <VStack align="stretch" gap={4}>
      <Text fontSize="sm" color="fg.DEFAULT/70" lineHeight="tall">
        <Text as="span" fontWeight="semibold" color="fg.DEFAULT">
          Live connection.
        </Text>{" "}
        Give your agent direct access to your LangWatch dashboard — search
        traces, manage prompts, and more.
      </Text>

      {/* JSON config */}
      <Box
        position="relative"
        overflow="hidden"
        {...glassCard({ highlight: false })}
      >
        <Box
          as="pre"
          px={5}
          py={4}
          pr={14}
          fontSize="xs"
          fontFamily="mono"
          color="fg.DEFAULT"
          lineHeight="tall"
          overflowX="auto"
          whiteSpace="pre"
        >
          {mcpJson}
        </Box>
        <Box position="absolute" top={3} right={3}>
          <InlineCopyButton text={mcpJson} label="Config" />
        </Box>
      </Box>

      {/* Where to paste */}
      <VStack
        align="stretch"
        gap={0}
        borderRadius="xl"
        border="1px solid"
        borderColor="gray.200"
        bg="white/70"
        boxShadow="0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 white"
        overflow="hidden"
      >
        <Box px={4} py={3} borderBottom="1px solid" borderColor="gray.100">
          <Text fontSize="xs" fontWeight="semibold" color="fg.DEFAULT">
            Add this to your editor&apos;s MCP config
          </Text>
        </Box>
        {EDITOR_PATHS.map((ep, i) => (
          <HStack
            key={ep.editor}
            px={4}
            py={2.5}
            justify="space-between"
            borderBottom={i < EDITOR_PATHS.length - 1 ? "1px solid" : undefined}
            borderColor="gray.100"
          >
            <Text fontSize="xs" color="fg.muted" fontWeight="medium">
              {ep.editor}
            </Text>
            <Text fontSize="xs" fontFamily="mono" color="fg.DEFAULT">
              {ep.path}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

export function ViaClaudeCodeScreen(): React.ReactElement {
  const router = useRouter();
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeTab, setActiveTab] = useState<TabKey>("prompt");

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;

  const mcpJson = useMemo(
    () =>
      buildMcpJson({ apiKey: effectiveApiKey, endpoint: effectiveEndpoint }),
    [effectiveApiKey, effectiveEndpoint],
  );

  return (
    <>
      <VStack align="stretch" gap={6} mb={20} maxW="640px" mx="auto">
        <Text fontSize="xs" color="fg.muted" lineHeight="tall" textAlign="center">
          Pick how you want to work with LangWatch in your coding agent.
        </Text>

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

        {activeTab === "prompt" && (
          <VStack align="stretch" gap={4}>
            <Text fontSize="sm" color="fg.DEFAULT/70" lineHeight="tall">
              <Text as="span" fontWeight="semibold" color="fg.DEFAULT">
                Zero setup.
              </Text>{" "}
              Copy a prompt, paste it into your coding agent, and it handles
              everything from there.
            </Text>
            {SKILLS.map((skill) => (
              <PromptRow key={skill.id} skill={skill} />
            ))}
          </VStack>
        )}

        {activeTab === "skill" && (
          <VStack align="stretch" gap={4}>
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
            {SKILLS.map((skill) => (
              <SkillRow key={skill.id} skill={skill} />
            ))}
          </VStack>
        )}

        {activeTab === "mcp" && <McpTab mcpJson={mcpJson} />}
      </VStack>

    </>
  );
}
