import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, Clipboard, Terminal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useMemo, useState } from "react";

const MotionVStack = motion(VStack);
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useActiveProject } from "../../contexts/ActiveProjectContext";
import {
  PROMPT_ANALYTICS,
  PROMPT_EVALUATIONS,
  PROMPT_LEVEL_UP,
  PROMPT_PROMPTS,
  PROMPT_SCENARIOS,
  PROMPT_TRACING,
} from "./code-prompts";
import { maskApiKey } from "./shared/api-key-utils";
import {
  buildMcpJson,
  CLOUD_ENDPOINT,
  findLangwatchEnvLines,
} from "./shared/build-mcp-config";
import { copyToClipboard } from "./shared/copy-to-clipboard";
import { InlineCopyButton } from "./shared/InlineCopyButton";
import { JsonHighlight } from "./shared/JsonHighlight";
import { TabButton } from "./shared/TabButton";

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
  {
    id: "level-up",
    label: "All of the above",
    prompt: PROMPT_LEVEL_UP,
    installCommand: "npx skills add langwatch/skills/level-up",
    slashCommand: "/level-up",
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

function glassCard(): Record<string, unknown> {
  return {
    borderRadius: "xl",
    border: "1px solid",
    borderColor: "border.subtle",
    bg: "bg.panel/70",
    backdropFilter: "blur(20px) saturate(1.3)",
    boxShadow: "sm",
    transition: "all 0.17s ease",
    _hover: {
      borderColor: "orange.emphasized",
      boxShadow: "md",
      transform: "translateY(-1px)",
    },
  };
}

function PromptRow({
  skill,
}: {
  skill: SkillItem;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard({
      text: skill.prompt,
      successMessage: "Prompt copied to clipboard",
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Whole-row button: clicking anywhere on the card copies the prompt
  // and triggers the Check-icon animation. Matches SkillRow's
  // click-anywhere-on-install-row pattern so prompt + skill share the
  // same affordance.
  return (
    <HStack
      asChild
      justify="space-between"
      align="center"
      px={4}
      py={2.5}
      gap={3}
      cursor="pointer"
      {...glassCard()}
    >
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="Copy prompt"
      >
        <Text
          fontSize="sm"
          color="fg"
          fontWeight={skill.highlight ? "semibold" : "medium"}
          letterSpacing="-0.01em"
          truncate
          flex={1}
          minW={0}
          textAlign="left"
        >
          {skill.label}
        </Text>
        {copied ? (
          <Check size={14} color="var(--chakra-colors-green-fg)" />
        ) : (
          <Clipboard size={14} color="var(--chakra-colors-fg-muted)" />
        )}
      </button>
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
      px={4}
      py={2.5}
      gap={1}
      {...glassCard()}
    >
      <HStack gap={2} align="baseline" minW={0}>
        <Text
          fontSize="sm"
          color="fg"
          fontWeight={skill.highlight ? "semibold" : "medium"}
          letterSpacing="-0.01em"
          truncate
          flex={1}
          minW={0}
        >
          {skill.label}
        </Text>
        <HStack
          asChild
          gap={1}
          align="center"
          flexShrink={0}
          color="orange.fg"
          cursor="pointer"
          _hover={{ opacity: 0.7 }}
          transition="opacity 0.15s ease"
        >
          <button
            type="button"
            aria-label={`Copy ${skill.slashCommand}`}
            onClick={() => {
              void copyToClipboard({
                text: skill.slashCommand,
                successMessage: `${skill.slashCommand} copied to clipboard`,
              });
            }}
          >
            <Text fontSize="xs" fontFamily="mono" fontWeight="semibold">
              {skill.slashCommand}
            </Text>
            <Clipboard size={10} />
          </button>
        </HStack>
      </HStack>
      <Tooltip
        content="Click to copy the install command"
        positioning={{ placement: "top" }}
        showArrow
        openDelay={300}
      >
        <HStack
          asChild
          gap={1.5}
          align="center"
          minW={0}
          paddingX={2}
          paddingY={1}
          marginInline={-2}
          borderRadius="md"
          cursor="pointer"
          _hover={{ bg: "bg.muted/60" }}
          transition="background 0.15s ease"
        >
          <button
            type="button"
            aria-label={`Copy install command: ${skill.installCommand}`}
            onClick={() => {
              void copyToClipboard({
                text: skill.installCommand,
                successMessage: "Install command copied to clipboard",
              });
            }}
          >
            <Terminal size={11} color="var(--chakra-colors-fg-subtle)" />
            <Text
              fontSize="xs"
              fontFamily="mono"
              color="fg.subtle"
              truncate
              flex={1}
              minW={0}
              textAlign="left"
            >
              {skill.installCommand}
            </Text>
            <Clipboard size={10} color="var(--chakra-colors-fg-subtle)" />
          </button>
        </HStack>
      </Tooltip>
    </VStack>
  );
}

/**
 * Splits a shell command at credential-bearing segments (LANGWATCH_* env
 * assignments and the `--api-key` flag) so they can be rendered with a
 * subtle orange accent. Everything else passes through untouched.
 */
function accentCredentialSegments(command: string): React.ReactNode[] {
  const re =
    /(--api-key \S+|LANGWATCH_(?:API_KEY|PROJECT_ID|ENDPOINT)=\S+)/g;
  return command.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <Text
        as="span"
        key={i}
        color="orange.fg"
        fontWeight="semibold"
      >
        {part}
      </Text>
    ) : (
      part
    ),
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
      {...glassCard()}
    >
      <HStack gap={2.5} align="center" minW={0}>
        <Box flexShrink={0} display="flex" alignItems="center">
          <Terminal size={13} color="var(--chakra-colors-fg-muted)" />
        </Box>
        <VStack align="start" gap={0} minW={0}>
          <Text fontSize="xs" fontWeight="semibold" color="fg">
            {label}
          </Text>
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" wordBreak="break-all">
            {accentCredentialSegments(displayCommand)}
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
  projectId,
}: {
  mcpJson: string;
  displayConfigJson: string;
  apiKey: string;
  maskedKey: string;
  endpoint: string | undefined;
  projectId: string | undefined;
}): React.ReactElement {
  const isSelfHosted = endpoint && endpoint !== CLOUD_ENDPOINT;
  const endpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";
  const maskedEndpointFlag = isSelfHosted ? ` --endpoint ${endpoint}` : "";
  // PROJECT_ID is plumbed through `claude mcp add`'s own --env flag (set
  // before `--`) so the MCP server inherits it via its environment, with
  // no dependency on a `--project-id` CLI flag we don't control. Codex
  // already uses --env consistently, so we just append.
  const projectIdEnvBefore = projectId
    ? ` --env LANGWATCH_PROJECT_ID=${projectId}`
    : "";
  const projectIdEnvAfter = projectId
    ? ` --env LANGWATCH_PROJECT_ID=${projectId}`
    : "";

  return (
    <VStack align="stretch" gap={4}>
      {/* Quick shortcuts */}
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="semibold" color="fg">
          Quick setup
        </Text>
        <QuickCommand
          label="Claude Code"
          displayCommand={`claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${maskedKey}${maskedEndpointFlag}`}
          copyCommand={`claude mcp add langwatch${projectIdEnvBefore} -- npx -y @langwatch/mcp-server --api-key ${apiKey}${endpointFlag}`}
        />
        <QuickCommand
          label="OpenAI Codex"
          displayCommand={`codex mcp add langwatch --env LANGWATCH_API_KEY=${maskedKey}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`}
          copyCommand={`codex mcp add langwatch --env LANGWATCH_API_KEY=${apiKey}${projectIdEnvAfter}${isSelfHosted ? ` --env LANGWATCH_ENDPOINT=${endpoint}` : ""} -- npx -y @langwatch/mcp-server`}
        />
      </VStack>

      {/* JSON config */}
      <Text fontSize="xs" fontWeight="semibold" color="fg">
        Or paste into your config file
      </Text>
      <Box
        position="relative"
        borderRadius="xl"
        overflow="hidden"
        border="1px solid"
        borderColor="border.subtle"
        bg="bg.panel/70"
        backdropFilter="blur(20px) saturate(1.3)"
        boxShadow="xs"
        transition="all 0.17s ease"
        _hover={{
          borderColor: "orange.emphasized",
          boxShadow: "md",
        }}
      >
        <JsonHighlight
          code={displayConfigJson}
          highlightLines={findLangwatchEnvLines(displayConfigJson)}
        />
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
              bg="bg.panel/60"
              border="1px solid"
              borderColor="border.subtle"
              cursor="pointer"
              transition="all 0.15s ease"
              _hover={{ borderColor: "orange.emphasized", bg: "bg.panel" }}
              onClick={() => {
                void copyToClipboard({
                  text: ep.path,
                  successMessage: `${ep.editor} config path copied`,
                });
              }}
            >
              <button type="button" aria-label={`Copy ${ep.editor} config path`}>
                <Text fontSize="2xs" fontWeight="medium" color="fg">
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

/**
 * Just the prompt list — no surrounding tabs / description / container
 * chrome. Used by the traces-v2 empty state which surfaces Prompt as a
 * top-level setup path instead of nesting it under "Via Coding Agent".
 */
export function PromptList(): React.ReactElement {
  return (
    <Grid
      templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
      gap={3}
    >
      {SKILLS.map((skill) => (
        <PromptRow key={skill.id} skill={skill} />
      ))}
    </Grid>
  );
}

/**
 * Just the skill list — same as PromptList but renders the install +
 * `/command` rows for the "Skill" top-level path.
 */
export function SkillList(): React.ReactElement {
  return (
    <Grid
      templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }}
      gap={3}
    >
      {SKILLS.map((skill) => (
        <SkillRow key={skill.id} skill={skill} />
      ))}
    </Grid>
  );
}

interface ViaClaudeCodeScreenProps {
  /**
   * When false, the MCP sub-tab is hidden. Used by the traces-v2 empty
   * state, which surfaces MCP setup as its own top-level tab and doesn't
   * want the duplicate. Defaults to true for the original onboarding flow.
   */
  showMcpTab?: boolean;
}

export function ViaClaudeCodeScreen({
  showMcpTab = true,
}: ViaClaudeCodeScreenProps = {}): React.ReactElement {
  const { project } = useActiveProject();
  const publicEnv = usePublicEnv();
  const [activeTab, setActiveTab] = useState<TabKey>("prompt");

  const effectiveApiKey = project?.apiKey ?? "";
  const effectiveEndpoint = publicEnv.data?.BASE_HOST;
  const effectiveProjectId = project?.id;

  const maskedApiKey = maskApiKey(effectiveApiKey);

  const mcpJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: effectiveApiKey,
        endpoint: effectiveEndpoint,
        projectId: effectiveProjectId,
      }),
    [effectiveApiKey, effectiveEndpoint, effectiveProjectId],
  );

  const displayConfigJson = useMemo(
    () =>
      buildMcpJson({
        apiKey: maskedApiKey,
        endpoint: effectiveEndpoint,
        projectId: effectiveProjectId,
      }),
    [maskedApiKey, effectiveEndpoint, effectiveProjectId],
  );

  return (
    <>
      <VStack
        align="stretch"
        gap={4}
        mb={20}
        // 640px keeps the prompt/MCP focus narrow; widen on prompt/skill
        // tabs so the 2-column row grids breathe and SkillRow's nested
        // command strips don't force-wrap.
        w={{
          base: "100%",
          md: activeTab === "skill" ? "880px" : "640px",
        }}
        maxW="100%"
        mx="auto"
      >
        <HStack
          justify="center"
          gap={1}
          mx="auto"
          px={1.5}
          py={1.5}
          borderRadius="xl"
          border="1px solid"
          borderColor="border.subtle"
          bg="bg.panel/70"
          backdropFilter="blur(20px) saturate(1.3)"
          boxShadow="sm"
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
          {showMcpTab && (
            <TabButton
              label="MCP"
              active={activeTab === "mcp"}
              onClick={() => setActiveTab("mcp")}
            />
          )}
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
              <Text fontSize="sm" color="fg/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg">
                  Zero setup.
                </Text>{" "}
                Copy a prompt, paste it into your coding agent, and it handles
                everything from there.
              </Text>
            )}
            {activeTab === "skill" && (
              <Text fontSize="sm" color="fg/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg">
                  Install once, reuse anytime.
                </Text>{" "}
                Run the install command, then type{" "}
                <Text as="span" fontFamily="mono" fontWeight="semibold" color="orange.fg">
                  /command
                </Text>{" "}
                in your coding agent whenever you need it.
              </Text>
            )}
            {showMcpTab && activeTab === "mcp" && (
              <Text fontSize="sm" color="fg/70" lineHeight="tall">
                <Text as="span" fontWeight="semibold" color="fg">
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
            gap={activeTab === "mcp" ? 0 : 6}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {activeTab === "prompt" && (
              <Grid
                templateColumns={{
                  base: "1fr",
                  md: "repeat(2, 1fr)",
                }}
                gap={3}
              >
                {SKILLS.map((skill) => (
                  <PromptRow key={skill.id} skill={skill} />
                ))}
              </Grid>
            )}
            {activeTab === "skill" && (
              <Grid
                templateColumns={{
                  base: "1fr",
                  lg: "repeat(2, 1fr)",
                }}
                gap={3}
              >
                {SKILLS.map((skill) => (
                  <SkillRow key={skill.id} skill={skill} />
                ))}
              </Grid>
            )}
            {showMcpTab && activeTab === "mcp" && (
              <McpTab
                mcpJson={mcpJson}
                displayConfigJson={displayConfigJson}
                apiKey={effectiveApiKey}
                maskedKey={maskedApiKey}
                endpoint={effectiveEndpoint}
                projectId={effectiveProjectId}
              />
            )}
          </MotionVStack>
        </AnimatePresence>
      </VStack>

    </>
  );
}
