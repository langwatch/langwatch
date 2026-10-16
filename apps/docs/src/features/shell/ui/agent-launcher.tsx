import { IconButton, Link } from "@langwatch/design-system/primitives";
import { ChevronDown, Copy, Terminal } from "lucide-react";

import { pagePath } from "../../../lib/site-path.ts";

const CODING_AGENTS = ["claude", "codex", "copilot", "gemini", "opencode"];

export function AgentLauncher() {
  return (
    <div className="docs-agent-launcher">
      <div className="docs-agent-line">
        <Terminal size={16} aria-hidden="true" />
        <code className="docs-agent-command">npx langwatch</code>
        <span className="docs-agent-pick">
          <span className="docs-agent-name" aria-hidden="true">
            claude
          </span>
          <select aria-label="Coding agent" defaultValue="claude">
            {CODING_AGENTS.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
          <ChevronDown size={12} aria-hidden="true" />
        </span>
        <IconButton
          type="button"
          disabled
          size="sm"
          variant="ghost"
          aria-label="Copy agent command"
          data-docs-copy="npx langwatch claude"
        >
          <Copy size={14} />
        </IconButton>
      </div>
      <p className="docs-agent-caption">
        Trace any coding agent ·{" "}
        <Link href={pagePath({ slug: "coding-agents/quickstart" })}>Setup guide →</Link>
      </p>
      <output className="docs-sr-only" aria-live="polite" />
    </div>
  );
}
