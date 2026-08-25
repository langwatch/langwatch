import { AgentActionsMenu } from "~/components/SetupWithAgentButton";
import { api } from "~/utils/api";
import { docsUrl } from "~/utils/docsUrl";

/**
 * "Connect your agent" on the /me usage home
 * (spec: specs/ai-governance/personal-portal/connect-your-agent-button.feature).
 *
 * The mirror image of `SetupWithAgentButton`: that one lives on empty states
 * and sets a feature up; this one appears only once usage EXISTS and hands an
 * agent the reader's own usage to explore. Same menu anatomy (copy-a-prompt,
 * Langy, docs), different job.
 *
 * The gate is `Project.firstMessage` on the personal project, the same
 * first-traces signal the authorize page's post-login watch polls
 * (`pages/cli/FirstTraceRedirect.tsx`). Before the first trace there is
 * nothing to explore, so the button stays out of the header entirely.
 */

/** Docs path for the guide the menu links; page lives in docs/ai-governance. */
export const EXPLORE_USAGE_DOCS_PATH =
  "/ai-governance/explore-your-usage-with-your-own-agent";

/** What Langy is asked when the reader picks "Explore via Langy". */
export const EXPLORE_USAGE_LANGY_PROMPT =
  "Where did my tokens go? Explore my recent usage: total spend this week, the most expensive sessions and what made them expensive, and which models and tools consumed the most.";

/**
 * The prompt handed to the reader's own coding agent. Exported for tests,
 * which also pin that the docs guide carries this exact prompt. A fresh
 * Claude Code session with the `langwatch` CLI available should be able to
 * paste it and immediately self-inspect: the CLI resolves the device-login
 * session on its own, so the prompt promises no API key and no env vars.
 */
export const EXPLORE_USAGE_AGENT_PROMPT = `Explore my LangWatch usage and tell me where my tokens and money went.

The \`langwatch\` CLI works with my device login: no API key and no env vars needed. If a command says I am not logged in, have me run \`langwatch login\` once, then continue. \`langwatch whoami\` prints who I am logged in as.

Read my usage with these commands (add \`-o json\` for machine-readable output):
- \`langwatch trace search --limit 50\` lists my recent sessions with cost and token totals (\`-q <text>\`, \`--start-date\` / \`--end-date\` to narrow)
- \`langwatch trace get <traceId>\` shows one session's full tree: models, per-span tokens, cache reads vs writes, tool calls
- \`langwatch analytics query -m total-cost --group-by metadata.model\` aggregates spend over time (other presets: trace-count, user-count; raw metric paths with \`-a sum|avg|p95\`)
- \`langwatch trace export -f jsonl\` dumps a whole window of traces when you want to crunch numbers yourself

Start with the last 7 days: total spend, the most expensive sessions and what made them expensive (context size, cache misses, subagents, retries), and which models consumed the most. Then answer my follow-up questions about my own usage from the same data.`;

export function ConnectYourAgentButton({
  projectId,
}: {
  /** The personal project whose first-traces flag gates the button. */
  projectId: string | null;
}) {
  const hasFirstMessage = api.project.getHasFirstMessage.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );

  // Absent until the first trace is CONFIRMED: an unresolved read renders
  // nothing rather than flashing a button that may not apply.
  if (!hasFirstMessage.data?.firstMessage) return null;

  return (
    <AgentActionsMenu
      triggerLabel="Connect your agent"
      langy={{
        prompt: EXPLORE_USAGE_LANGY_PROMPT,
        label: "Explore via Langy",
        hint: "Ask Langy where your tokens went",
      }}
      copy={{
        prompt: EXPLORE_USAGE_AGENT_PROMPT,
        label: "Explore via your coding agent",
        hint: "Copy a prompt so Claude Code can inspect your own usage",
        copiedTitle: "Prompt copied. Paste it into your coding agent",
      }}
      docs={{
        href: docsUrl(EXPLORE_USAGE_DOCS_PATH),
        label: "Read the guide",
        hint: "One-time setup and the questions your agent can answer",
      }}
    />
  );
}
