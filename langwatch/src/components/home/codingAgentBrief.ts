import { toaster } from "~/components/ui/toaster";

export const INTEGRATION_DOCS =
  "https://docs.langwatch.ai/integration/overview";

/**
 * The brief you hand to YOUR coding agent.
 *
 * This is the honest version of "onboard your agent": most people reading this
 * line are about to go and instrument a codebase, and the fastest way through
 * that is not a tab of documentation, it is a brief their own agent can act on.
 * It names the docs rather than reciting an API, because reciting one here is
 * how it silently goes stale the next time the SDK changes.
 *
 * Shared by the hero's quiet setup line and the docs section's onboarding
 * control, so the two hand out the same brief. Spec:
 * specs/home/langy-home.feature
 */
export const CODING_AGENT_BRIEF = `Instrument this codebase with LangWatch so I can see my agent's traces.

Read the integration guide at ${INTEGRATION_DOCS} and pick the SDK that matches this project. Then:
1. Add the dependency and initialise it where the app starts.
2. Read the API key from the environment, never hardcode it.
3. Instrument the main agent or LLM call path so a request produces one trace.
4. Tell me what you changed and how to verify a trace arrives.`;

/**
 * Copy the brief, and say so.
 *
 * A toast, not an inline "Copied" label: one caller is a Menu.Item and zag's
 * menu closes on select, so an inline confirmation would render into a menu
 * that was already gone — unreachable, and a copy that says nothing is
 * indistinguishable from one that failed. The toast also gives the rejection
 * path somewhere to go.
 */
export function copyCodingAgentBrief(): void {
  void navigator.clipboard?.writeText(CODING_AGENT_BRIEF).then(
    () =>
      toaster.create({
        type: "success",
        title: "Brief copied — paste it to your coding agent",
      }),
    () =>
      toaster.create({
        type: "error",
        title: "Couldn't copy the brief",
      }),
  );
}
