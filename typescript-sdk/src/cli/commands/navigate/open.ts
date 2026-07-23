import { checkApiKey } from "../../utils/apiKey";

/**
 * Ask the platform to open, in the user's browser, a resource Langy already
 * looked up in this conversation.
 *
 * The process itself only prints `{"resourceId"}` — deliberately. It runs
 * inside the sandboxed worker, which has no browser to open and must never
 * author an address. The SIGNAL is the shell invocation: the control-plane
 * relay recognizes `langwatch navigate open <id>` on the tool-call stream,
 * resolves the resource's own server-computed `platformUrl` (from the CLI
 * call that originally surfaced it, or a project-scoped platform lookup),
 * and pushes a live `navigate` instruction to the user's browser, which
 * moves via the SPA router. So: run under Langy, it opens; run standalone in
 * a terminal, there is no browser session to move and it is inert on purpose.
 *
 * This command carries ONLY the resource's id — never an address. A resource
 * the platform cannot resolve within the project is silently not navigated
 * to.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
export const navigateOpenCommand = async (
  resourceId: string,
): Promise<void> => {
  checkApiKey();
  console.log(JSON.stringify({ resourceId }));
};
