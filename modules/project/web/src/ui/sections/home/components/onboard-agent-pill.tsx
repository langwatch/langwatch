import { LuBot, LuSparkles, LuTerminal } from "react-icons/lu";
import {
  AgentActionsMenu,
  setupAgentPrompt,
} from "@langwatch/trace-web/surfaces/setup-with-agent-button";
import { selfHostedEndpoint } from "../../../../model/self-hosted-endpoint.ts";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
import { HeroLeadPill } from "@langwatch/design-system/hero-lead-pill";

const INTEGRATION_DOCS = "https://docs.langwatch.ai/integration/overview";

const LANGY_WALKTHROUGH_PROMPT =
  "Walk me through sending my first trace to this project. Ask me what my agent is built with, then give me the exact steps.";

/**
 * The route into agent onboarding on the home page: skill to an open coding
 * agent, or hand it to Langy, docs third. `onAskLangy` absent means that
 * item must not appear. Spec: specs/home/langy-home.feature
 */
export function OnboardAgentPill({
  onAskLangy,
  prominent = false,
}: {
  /** Start the onboarding conversation. Omitted where Langy is unavailable. */
  onAskLangy?: (prompt: string) => void;
  /**
   * Lead with it: for a project with no data, this is the only thing that
   * makes the rest of the page mean anything, so it's the filled control
   * the eye lands on, not a quiet outline at the end of a row.
   */
  prominent?: boolean;
} = {}) {
  const project = useProjectHomeHost().project();
  const deployment = useProjectHomeHost().deployment();
  const canAsk = useProjectHomeHost().canAskLangy();
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
        apiKey: project?.apiKey ?? undefined,
        endpoint: selfHostedEndpoint(deployment.baseHost) ?? undefined,
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
