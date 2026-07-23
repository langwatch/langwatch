import { Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import {
  LuBookOpen,
  LuChevronDown,
  LuSparkles,
  LuTerminal,
} from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";

/**
 * The set-up-with-AI control every feature page's empty state carries
 * (spec: specs/skills/empty-state-skill-setup.feature).
 *
 * One menu, three routes, all fed by the surface's own docs skill: hand
 * the job to Langy (who has the skills loaded), copy a prompt that
 * installs the skill into the reader's own coding agent, or read that
 * feature's docs. It lives on the empty states rather than the home
 * because that is where the gap it fills actually is.
 *
 * The coding-agent prompt points at the skill instead of reciting its
 * steps: recited steps go silently stale the next time the skill
 * changes, while `npx skills add` always installs the current one.
 */

const SKILLS_DIRECTORY_URL = "https://langwatch.ai/docs/skills/directory";

interface SurfaceSetup {
  /** The docs skill that owns this surface's setup. */
  skill: string;
  /** The skill's own trigger phrasing — the first line of the copied prompt. */
  trigger: string;
  /** What Langy is asked. Repo-connected surfaces (the ones whose setup
   *  lands as code changes) also ask to connect the repository and open a
   *  pull request; purely in-platform surfaces do not. */
  langyPrompt: string;
  docsUrl: string;
  /** The docs item's label ("Read the <docsLabel>"). */
  docsLabel: string;
}

export const SETUP_SURFACES = {
  traces: {
    skill: "tracing",
    trigger: "Instrument my code with LangWatch",
    langyPrompt:
      "Instrument my codebase with LangWatch tracing. Connect to my repository, add the instrumentation, and open a pull request with the changes.",
    docsUrl: "https://docs.langwatch.ai/integration/overview",
    docsLabel: "integration guide",
  },
  experiments: {
    skill: "experiments",
    trigger: "Set up experiments for my agent",
    langyPrompt:
      "Set up experiments for my agent. Connect to my repository if the setup needs code, and open a pull request with it.",
    docsUrl: "https://langwatch.ai/docs/evaluations/experiments/overview",
    docsLabel: "experiments documentation",
  },
  onlineEvaluations: {
    skill: "online-evaluations",
    trigger: "Set up online evaluations for my agent",
    langyPrompt:
      "Set up online evaluations for my agent: help me choose what to score on live traffic and create the evaluations.",
    docsUrl: "https://langwatch.ai/docs/evaluations/online-evaluation/overview",
    docsLabel: "online evaluations documentation",
  },
  evaluators: {
    skill: "online-evaluations",
    trigger: "Set up online evaluations for my agent",
    langyPrompt:
      "Help me create an evaluator for my agent and wire it into online evaluations.",
    docsUrl: "https://langwatch.ai/docs/evaluations/online-evaluation/overview",
    docsLabel: "online evaluations documentation",
  },
  simulations: {
    skill: "scenarios",
    trigger: "Add scenario tests for my agent",
    langyPrompt:
      "Add scenario tests for my agent. Connect to my repository and open a pull request with the first simulation suite.",
    docsUrl: "https://docs.langwatch.ai/agent-simulations/introduction",
    docsLabel: "simulations documentation",
  },
  simulationRuns: {
    skill: "scenarios",
    trigger: "Add scenario tests for my agent",
    langyPrompt:
      "Add scenario tests for my agent. Connect to my repository and open a pull request with the first simulation suite.",
    docsUrl: "https://docs.langwatch.ai/agent-simulations/introduction",
    docsLabel: "simulations documentation",
  },
  prompts: {
    skill: "prompts",
    trigger: "Version my prompts with LangWatch",
    langyPrompt:
      "Version my prompts with LangWatch: help me import my existing prompts and manage them here.",
    docsUrl: "https://docs.langwatch.ai/prompt-management/overview",
    docsLabel: "prompt management documentation",
  },
  datasets: {
    skill: "datasets",
    trigger: "Generate a realistic evaluation dataset for my agent",
    langyPrompt:
      "Generate a realistic evaluation dataset for my agent and upload it to this project.",
    docsUrl: "https://docs.langwatch.ai/datasets/overview",
    docsLabel: "datasets documentation",
  },
} as const satisfies Record<string, SurfaceSetup>;

export type SetupSurface = keyof typeof SETUP_SURFACES;

/** The prompt handed to the reader's own coding agent. Exported for tests. */
export function setupAgentPrompt(surface: SetupSurface): string {
  const setup = SETUP_SURFACES[surface];
  return `${setup.trigger}.

Use LangWatch's "${setup.skill}" skill for this: install it with \`npx skills add langwatch/skills/${setup.skill}\` and follow it. Every available skill is listed at ${SKILLS_DIRECTORY_URL}. Read the API key from the environment, never hardcode it, and tell me what you changed and how to verify it.`;
}

export function SetupWithAgentButton({
  surface,
  size = "sm",
}: {
  surface: SetupSurface;
  /** Match the sibling buttons of the empty state this sits in. */
  size?: "sm" | "md";
}) {
  const setup = SETUP_SURFACES[surface];
  const canAsk = useCanAskLangy();
  const askLangy = useLangyStore((s) => s.askLangy);

  // A toast, not an inline label: zag's menu closes on select, so any
  // confirmation rendered inside it would land in a menu that is already
  // gone. The toast also gives the clipboard-rejection path somewhere to go.
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(setupAgentPrompt(surface)).then(
      () =>
        toaster.create({
          type: "success",
          title: "Prompt copied — paste it to your coding agent",
        }),
      () =>
        toaster.create({
          type: "error",
          title: "Couldn't copy the prompt",
        }),
    );
  };

  return (
    <Menu.Root positioning={{ placement: "bottom-end", gutter: 6 }}>
      <Menu.Trigger asChild>
        {/* The same outline/size the primary actions on these pages wear
            (PageLayout.HeaderButton), so the control reads as one of the
            page's own buttons rather than a themed import. */}
        <Button variant="outline" size={size} aria-haspopup="menu">
          <LuSparkles size={14} />
          Setup via Agent
          <LuChevronDown size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="300px" padding={1}>
        {canAsk ? (
          <Menu.Item
            value="ask-langy"
            paddingY={2}
            onClick={() => askLangy(setup.langyPrompt)}
          >
            <SetupOption
              icon={LuSparkles}
              accent
              label="Ask Langy to set it up"
              hint="Langy walks you through it and does the setup with you"
            />
          </Menu.Item>
        ) : null}
        <Menu.Item value="copy-prompt" paddingY={2} onClick={copyPrompt}>
          <SetupOption
            icon={LuTerminal}
            label="Copy a prompt for your coding agent"
            hint="Paste it into Claude Code, Cursor, or whatever you use"
          />
        </Menu.Item>
        <Menu.Item value="docs" paddingY={2} asChild>
          <chakra.a href={setup.docsUrl} target="_blank" rel="noreferrer">
            <SetupOption
              icon={LuBookOpen}
              label={`Read the ${setup.docsLabel}`}
              hint="The overview, and every path into the feature"
            />
          </chakra.a>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

function SetupOption({
  icon: Icon,
  label,
  hint,
  accent = false,
}: {
  icon: typeof LuSparkles;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <HStack gap={2.5} width="full" align="start">
      <Box
        color={accent ? "orange.fg" : "fg.subtle"}
        display="grid"
        paddingTop="2px"
      >
        <Icon size={13} />
      </Box>
      <Box minWidth={0} flex={1}>
        <Text textStyle="xs" fontWeight="medium">
          {label}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" lineClamp={2}>
          {hint}
        </Text>
      </Box>
    </HStack>
  );
}
