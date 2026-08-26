import { Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
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
import { withCredentials } from "~/features/skills/logic/setupPrompt";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * The set-up-with-AI control every feature page's empty state carries
 * (spec: specs/skills/empty-state-skill-setup.feature).
 *
 * One menu, three routes, all fed by the surface's own docs skill: copy
 * the skill for the reader's own coding agent, hand the job to Langy
 * (who has the skills loaded), or read that feature's docs. It lives on
 * the empty states rather than the home because that is where the gap
 * it fills actually is.
 *
 * The copied text is the skill itself rather than a line telling the
 * agent to fetch it, so the paste carries every instruction and works
 * on an agent with no network. The server holds the bodies and the menu
 * asks for one when it opens; the install line is what a reader gets if
 * that request has not answered yet.
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
  apiKey,
  endpoint,
}: {
  surface: SetupSurface;
  /** Match the sibling buttons of the empty state this sits in. */
  size?: "sm" | "md";
  /**
   * A token the surface just minted. When set, the copied text opens
   * with the credentials so the agent can write them straight into an
   * `.env` instead of asking the reader for them.
   */
  apiKey?: string;
  /** The endpoint those credentials belong to, on a self-hosted deployment. */
  endpoint?: string;
}) {
  const setup = SETUP_SURFACES[surface];
  return (
    <AgentActionsMenu
      triggerLabel="Setup via Agent"
      size={size}
      langy={{
        prompt: setup.langyPrompt,
        label: "Ask Langy to set it up",
        hint: "Langy walks you through it and does the setup with you",
      }}
      copy={{
        prompt: setupAgentPrompt(surface),
        skill: setup.skill,
        apiKey,
        endpoint,
        label: "Copy a prompt for your coding agent",
        hint: "Paste it into Claude Code, Cursor, or whatever you use",
        copiedTitle: "Prompt copied. Paste it to your coding agent",
      }}
      docs={{
        href: setup.docsUrl,
        label: `Read the ${setup.docsLabel}`,
        hint: "The overview, and every path into the feature",
      }}
    />
  );
}

/**
 * The one agent-actions menu shell: a trigger, the copy-a-prompt entry with
 * its confirmation toast, the Langy entry (shown only when the viewer can
 * ask Langy), and the docs link. `SetupWithAgentButton`, the home
 * `OnboardAgentPill` and the /me `ConnectYourAgentButton` are all thin
 * configurations of this, so the controls can never drift apart in anatomy
 * or behavior.
 */
export function AgentActionsMenu({
  triggerLabel,
  trigger,
  size = "sm",
  langy,
  copy,
  docs,
}: {
  /** Labels the default outline button. Ignored when `trigger` is given. */
  triggerLabel?: string;
  /**
   * A trigger of the surface's own, in place of the default button.
   * One element, because `Menu.Trigger asChild` clones it with the
   * handlers and the ref: a string or a list has nowhere to put them.
   */
  trigger?: React.ReactElement;
  /** Match the sibling buttons of the surface this sits in. */
  size?: "sm" | "md";
  /**
   * Null where the surface already knows Langy is out of reach. Otherwise
   * the entry still needs `useCanAskLangy` to agree.
   */
  langy: {
    prompt: string;
    label: string;
    hint: string;
    /**
     * Takes the prompt instead of the Langy store, for a surface that
     * animates its own composer on the way in.
     */
    onAsk?: (prompt: string) => void;
  } | null;
  copy: {
    /** What the reader gets while the skill is still on its way. */
    prompt: string;
    label: string;
    hint: string;
    copiedTitle: string;
    /** The skill whose instructions the copy carries, when there is one. */
    skill?: string;
    /** A freshly minted token to put in front of those instructions. */
    apiKey?: string;
    /** The endpoint that token belongs to, on a self-hosted deployment. */
    endpoint?: string;
  };
  docs: {
    href: string;
    label: string;
    hint: string;
    /** Overrides the book glyph where the surface reads better with another. */
    icon?: typeof LuBookOpen;
  };
}) {
  const canAsk = useCanAskLangy();
  const askLangy = useLangyStore((s) => s.askLangy);
  const [isOpen, setIsOpen] = useState(false);
  const skillPrompt = useSetupSkillPrompt({
    skill: copy.skill,
    apiKey: copy.apiKey,
    endpoint: copy.endpoint,
    enabled: isOpen,
  });

  // A toast, not an inline label: zag's menu closes on select, so any
  // confirmation rendered inside it would land in a menu that is already
  // gone. The toast also gives the clipboard-rejection path somewhere to go.
  const copyPrompt = () => {
    void navigator.clipboard?.writeText(skillPrompt ?? copy.prompt).then(
      () =>
        toaster.create({
          type: "success",
          title: copy.copiedTitle,
        }),
      () =>
        toaster.create({
          type: "error",
          title: "Couldn't copy the prompt",
        }),
    );
  };

  return (
    <Menu.Root
      positioning={{ placement: "bottom-end", gutter: 6 }}
      onOpenChange={(details) => setIsOpen(details.open)}
    >
      <Menu.Trigger asChild>
        {/* The same outline/size the primary actions on these pages wear
            (PageLayout.HeaderButton), so the control reads as one of the
            page's own buttons rather than a themed import. */}
        {trigger ?? (
          <Button variant="outline" size={size} aria-haspopup="menu">
            <LuSparkles size={14} />
            {triggerLabel}
            <LuChevronDown size={14} />
          </Button>
        )}
      </Menu.Trigger>
      <Menu.Content minWidth="300px" padding={1}>
        <Menu.Item value="copy-prompt" paddingY={2} onClick={copyPrompt}>
          <AgentMenuOption
            icon={LuTerminal}
            label={copy.label}
            hint={copy.hint}
          />
        </Menu.Item>
        {langy && canAsk ? (
          <Menu.Item
            value="ask-langy"
            paddingY={2}
            onClick={() => (langy.onAsk ?? askLangy)(langy.prompt)}
          >
            <AgentMenuOption
              icon={LuSparkles}
              accent
              label={langy.label}
              hint={langy.hint}
            />
          </Menu.Item>
        ) : null}
        <Menu.Item value="docs" paddingY={2} asChild>
          <chakra.a href={docs.href} target="_blank" rel="noreferrer">
            <AgentMenuOption
              icon={docs.icon ?? LuBookOpen}
              label={docs.label}
              hint={docs.hint}
            />
          </chakra.a>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * The skill's own instructions for this project, fetched once the menu
 * opens so the reader is not waiting on 94 kB of markdown they may
 * never copy. Null until it answers, which is what falls the copy back
 * to the install line.
 *
 * The token goes above the body here rather than being sent along with
 * the request: the query travels as a GET, so a token in its input
 * would be written into every log that records a URL.
 */
function useSetupSkillPrompt({
  skill,
  apiKey,
  endpoint,
  enabled,
}: {
  skill: string | undefined;
  apiKey: string | undefined;
  endpoint: string | undefined;
  enabled: boolean;
}): string | null {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const projectId = project?.id;
  const { data } = api.setupSkills.getPrompt.useQuery(
    { projectId: projectId!, skill: skill! },
    { enabled: enabled && !!skill && !!projectId, staleTime: Infinity },
  );
  if (!data || !projectId) return null;
  return withCredentials({
    body: data.body,
    credentials: apiKey ? { apiKey, projectId, endpoint } : undefined,
  });
}

/** The icon + label + hint row every agent-menu entry renders. */
function AgentMenuOption({
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
