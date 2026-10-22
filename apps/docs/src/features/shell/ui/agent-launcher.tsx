import { IconButton, Link } from "@langwatch/design-system/primitives";
import { ChevronDown, Copy, Terminal } from "lucide-react";
import type { CSSProperties } from "react";

import { pagePath } from "../../../lib/site-path.ts";
import { CODING_AGENTS, wheelOffset } from "../model/agent-wheel.ts";

const START = "claude";

export function AgentLauncher() {
  return (
    <div className="docs-agent-launcher">
      <div className="docs-agent-line">
        <Terminal size={16} aria-hidden="true" />
        <code className="docs-agent-command">npx langwatch</code>
        <span className="docs-agent-pick">
          {/* Names are drawn from data-agent by CSS: decoration, so the faded ones need no contrast. */}
          <span className="docs-agent-wheel" aria-hidden="true">
            {CODING_AGENTS.map((agent, index) => {
              const offset = wheelOffset({ index, chosen: CODING_AGENTS.indexOf(START) });
              return (
                <span
                  key={agent}
                  className="docs-agent-name"
                  data-agent={agent}
                  data-distance={Math.abs(offset)}
                  style={{ "--docs-agent-offset": offset } as CSSProperties}
                />
              );
            })}
          </span>
          <select aria-label="Coding agent" defaultValue={START}>
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
          data-docs-copy={`npx langwatch ${START}`}
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
