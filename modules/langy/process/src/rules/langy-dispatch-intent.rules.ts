/** How the worker should start a turn: revive a parked handoff, create a session, or continue one. */
export function dispatchIntentOf({
  resumable,
  hasApiKey,
}: {
  resumable: boolean;
  hasApiKey: boolean;
}): "create" | "revive" | "continue" {
  if (resumable) return "revive";
  return hasApiKey ? "create" : "continue";
}
