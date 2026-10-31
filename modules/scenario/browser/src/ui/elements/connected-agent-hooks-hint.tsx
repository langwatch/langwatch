/**
 * One muted line saying what a connected agent declares for setup and teardown (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import {
  agentHooksSchema,
  connectedAgentHooksCopy,
  HOOKS_DOCS_URL,
} from "@langwatch/agent-contract";
import { Link } from "@langwatch/browser-host/link";
import { Text } from "@langwatch/design-system/primitives";

/** An old or empty config declares none. */
function declaredHooksOf(config: unknown) {
  const hooks =
    typeof config === "object" && config !== null && "hooks" in config ? config.hooks : undefined;
  return agentHooksSchema.safeParse(hooks).data;
}

export function ConnectedAgentHooksHint({
  status,
  config,
}: {
  status?: "online" | "offline";
  config?: unknown;
}) {
  return (
    <Text textStyle="caption" color="fg.muted" data-testid="connected-agent-hooks-hint">
      {connectedAgentHooksCopy({ isOnline: status === "online", hooks: declaredHooksOf(config) })}{" "}
      <Link href={HOOKS_DOCS_URL} target="_blank" color="blue.fg">
        Learn more
      </Link>
    </Text>
  );
}
