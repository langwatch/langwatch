import { LuBot, LuSparkles, LuTerminal } from "react-icons/lu";
import {
  AgentActionsMenu,
  setupAgentPrompt,
} from "~/components/SetupWithAgentButton";
import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { selfHostedEndpoint } from "~/features/traces-v2/onboarding/logic/selfHostedEndpoint";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { HeroLeadPill } from "./HeroLeadPill";

const INTEGRATION_DOCS = "https://docs.langwatch.ai/integration/overview";

const LANGY_WALKTHROUGH_PROMPT =
  "Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.";

/**
 * The route into agent onboarding on the home page: friendly copy, tool
 * glyphs in their own small tiles.
 *
 * It offers the two ways people actually onboard an agent: take the tracing
 * skill away to the coding agent already open in their editor, or hand the
 * job to Langy. The docs are third, for the reader who wanted them all along.
 *
 * The menu itself is `AgentActionsMenu`, the same one every empty state
 * carries, so the routes stay in one order and the copied text stays the one
 * text. Only the trigger and the wording are this surface's own.
 *
 * `onAskLangy` is optional, and its absence is meaningful: on a page where
 * Langy is not available that item must not appear, rather than appear and
 * fail. Spec: specs/home/langy-home.feature
 */
export function OnboardAgentPill({
  onAskLangy,
  prominent = false,
}: {
  /** Start the onboarding conversation. Omitted where Langy is unavailable. */
  onAskLangy?: (prompt: string) => void;
  /**
   * Lead with it rather than tuck it away. For a project with no data, this is
   * not one option among several: it is the only thing that makes the rest of
   * the page mean anything, so it stops being a quiet outline at the end of a
   * row and becomes the filled control the eye lands on.
   */
  prominent?: boolean;
} = {}) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const publicEnv = usePublicEnv();
  const canAsk = useCanAskLangy();
  // The same condition the menu itself applies, so the tiles on the pill
  // count the routes the menu actually opens with.
  const hasLangy = !!onAskLangy && canAsk;

  return (
    <AgentActionsMenu
      trigger={
        <HeroLeadPill
          prominent={prominent}
          label={prominent ? "Send your first trace" : "Onboard your agent"}
          // The tiles read left to right in the order the menu offers its
          // routes, and drop the Langy tile where the menu drops the route.
          glyphs={[
            { key: "copy", icon: <LuTerminal size={10} /> },
            ...(hasLangy
              ? [
                  {
                    key: "langy",
                    icon: <LuSparkles size={10} />,
                    color: "orange.fg",
                  },
                ]
              : []),
            { key: "docs", icon: <LuBot size={10} /> },
          ]}
        />
      }
      langy={
        hasLangy && onAskLangy
          ? {
              prompt: LANGY_WALKTHROUGH_PROMPT,
              onAsk: onAskLangy,
              label: "Walk me through it",
              hint: "Langy asks what you are building, then gives you the steps",
            }
          : null
      }
      copy={{
        prompt: setupAgentPrompt("traces"),
        skill: "tracing",
        // The project's own key, so the agent gets a setup it can run rather
        // than one that stops to ask for credentials.
        apiKey: project?.apiKey,
        endpoint: selfHostedEndpoint(publicEnv.data?.BASE_HOST) ?? undefined,
        label: "Copy a prompt for your coding agent",
        hint: "Paste it into Claude Code, Cursor, or whatever you use",
        copiedTitle: "Prompt copied. Paste it to your coding agent",
      }}
      docs={{
        href: INTEGRATION_DOCS,
        icon: LuBot,
        label: "Read the integration guide",
        hint: "Every SDK, and what each one instruments",
      }}
    />
  );
}
