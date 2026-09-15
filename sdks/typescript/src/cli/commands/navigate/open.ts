import { resolveCredentials } from "../../utils/apiKey";

/**
 * Signal to platform to open resource in user's browser.
 * Prints resourceId only; langy relay resolves platformUrl and navigates.
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
export const navigateOpenCommand = async (resourceId: string): Promise<void> => {
  await resolveCredentials();
  console.log(JSON.stringify({ resourceId }));
};
