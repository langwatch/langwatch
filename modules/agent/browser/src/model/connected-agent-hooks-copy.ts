/** The docs page on hooks that live in the agent's own code. */
export const HOOKS_DOCS_URL = "https://langwatch.ai/docs/agent-testing/setup-and-teardown-hooks";

/** What to tell about hooks: the declared ones while the agent is online, else the general line. */
export function connectedAgentHooksCopy({
  isOnline,
  hooks,
}: {
  isOnline: boolean;
  hooks?: { setup?: boolean; teardown?: boolean };
}): string {
  if (!isOnline) {
    return "Setup and teardown hooks run from this agent's code, before and after each scenario run.";
  }
  if (hooks?.setup && hooks.teardown) {
    return "This agent's code declares setup and teardown hooks; they run before and after each scenario run.";
  }
  if (hooks?.setup) {
    return "This agent's code declares a setup hook; it runs before each scenario run.";
  }
  if (hooks?.teardown) {
    return "This agent's code declares a teardown hook; it runs after each scenario run.";
  }
  return "No setup or teardown hooks declared. Add them in the agent's code.";
}
