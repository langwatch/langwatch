/**
 * One muted line saying what a connected agent declares for setup and teardown (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { Link } from "@langwatch/browser-host/link";
import { Text } from "@langwatch/design-system/primitives";

import { connectedAgentHooksCopy, HOOKS_DOCS_URL } from "../../model/connected-agent-hooks-copy.ts";

export function ConnectedAgentHooksHint({
  status,
  hooks,
}: {
  status: "online" | "offline";
  hooks?: { setup?: boolean; teardown?: boolean };
}) {
  return (
    <Text textStyle="caption" color="fg.muted" data-testid="connected-agent-hooks-hint">
      {connectedAgentHooksCopy({ isOnline: status === "online", hooks })}{" "}
      <Link href={HOOKS_DOCS_URL} target="_blank" color="blue.fg">
        Learn more
      </Link>
    </Text>
  );
}
