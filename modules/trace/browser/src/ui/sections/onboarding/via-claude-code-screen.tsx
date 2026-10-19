import { Grid, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Check, Clipboard, Terminal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useAnalytics } from "react-contextual-analytics";

import { copyToClipboard } from "../../../behavior/onboarding/shared/copy-to-clipboard.ts";
import {
  PROMPT_AGENT_PERFORMANCE,
  PROMPT_EXPERIMENTS,
  PROMPT_LEVEL_UP,
  PROMPT_ONLINE_EVALUATIONS,
  PROMPT_PROMPTS,
  PROMPT_SCENARIOS,
  PROMPT_TRACING,
} from "../../../model/onboarding/code-prompts.ts";

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
    id: "experiments",
    label: "Run experiments for your agent",
    prompt: PROMPT_EXPERIMENTS,
    installCommand: "npx skills add langwatch/skills/experiments",
    slashCommand: "/experiments",
  },
  {
    id: "online-evaluations",
    label: "Set up online evaluations and guardrails",
    prompt: PROMPT_ONLINE_EVALUATIONS,
    installCommand: "npx skills add langwatch/skills/online-evaluations",
    slashCommand: "/online-evaluations",
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
    id: "agent-performance",
    label: "Diagnose your agent's production behavior",
    prompt: PROMPT_AGENT_PERFORMANCE,
    installCommand: "npx skills add langwatch/skills/agent-performance",
    slashCommand: "/agent-performance",
  },
  {
    id: "level-up",
    label: "All of the above",
    prompt: PROMPT_LEVEL_UP,
    installCommand: "npx skills add langwatch/skills/level-up",
    slashCommand: "/level-up",
  },
];

/**
 * Skill id for "Add LangWatch tracing to your code". The traces onboarding
 * leads with this one — see `orderSkills`.
 */
export const TRACING_SKILL_ID = "tracing";

/**
 * Returns SKILLS with `primarySkillId` moved to the front, preserving the
 * relative order of the rest — lets the traces empty state lead with tracing
 * without reordering the shared list. Unknown/absent ids are a no-op.
 */
function orderSkills(primarySkillId?: string): SkillItem[] {
  if (!primarySkillId) return SKILLS;
  const primary = SKILLS.find((skill) => skill.id === primarySkillId);
  if (!primary) return SKILLS;
  return [primary, ...SKILLS.filter((skill) => skill.id !== primarySkillId)];
}

function glassCard(): Record<string, unknown> {
  // No `backdropFilter` here: these cards sit on the same surface as their
  // parent (`bg.surface` under `bg.panel`, same colour family) — a blur over
  // identical content is invisible work, multiplied N-per-grid. Blur stays
  // where it has something to filter through: drawers, dialogs, toolbar.
  return {
    borderRadius: "xl",
    border: "1px solid",
    borderColor: "border.subtle",
    bg: "bg.panel/70",
    boxShadow: "sm",
    transition: "all 0.17s ease",
    _hover: {
      borderColor: "orange.emphasized",
      boxShadow: "md",
      transform: "translateY(-1px)",
    },
  };
}

function PromptRow({ skill }: { skill: SkillItem }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const { emit } = useAnalytics();

  const handleCopy = async (): Promise<void> => {
    const ok = await copyToClipboard({
      text: skill.prompt,
      successMessage: "Prompt copied to clipboard",
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      emit("copied", "prompt", { skill: skill.id });
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
      <button type="button" onClick={() => void handleCopy()} aria-label="Copy prompt">
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

function SkillRow({ skill }: { skill: SkillItem }): React.ReactElement {
  const { emit } = useAnalytics();

  return (
    <VStack align="stretch" px={4} py={2.5} gap={1} {...glassCard()}>
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
        <Tooltip
          content={`Click to copy ${skill.slashCommand}`}
          positioning={{ placement: "top" }}
          showArrow
          openDelay={300}
        >
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
                }).then((ok) => {
                  if (ok) emit("copied", "slash_command", { skill: skill.id });
                });
              }}
            >
              <Text fontSize="xs" fontFamily="mono" fontWeight="semibold">
                {skill.slashCommand}
              </Text>
            </button>
          </HStack>
        </Tooltip>
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
              }).then((ok) => {
                if (ok) emit("copied", "install_command", { skill: skill.id });
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
 * Just the prompt list — no surrounding tabs / description / container
 * chrome. Used by the traces-v2 empty state which surfaces Prompt as a
 * top-level setup path instead of nesting it under "Via Coding Agent".
 */
export function PromptList({
  primarySkillId,
}: {
  /** Skill id to surface first; the rest keep their default order. */
  primarySkillId?: string;
} = {}): React.ReactElement {
  return (
    <Grid templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap={3}>
      {orderSkills(primarySkillId).map((skill) => (
        <PromptRow key={skill.id} skill={skill} />
      ))}
    </Grid>
  );
}

/**
 * Just the skill list — same as PromptList but renders the install +
 * `/command` rows for the "Skill" top-level path.
 */
export function SkillList({
  primarySkillId,
}: {
  /** Skill id to surface first; the rest keep their default order. */
  primarySkillId?: string;
} = {}): React.ReactElement {
  return (
    <Grid templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }} gap={3}>
      {orderSkills(primarySkillId).map((skill) => (
        <SkillRow key={skill.id} skill={skill} />
      ))}
    </Grid>
  );
}
