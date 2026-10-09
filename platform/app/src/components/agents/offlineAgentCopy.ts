/**
 * What an offline connected agent says on hover where it cannot be used.
 *
 * A connected agent no process is holding can neither be tested nor picked as
 * a run target, so each place draws it disabled and says what starting the
 * process allows. The refusal a run itself answers with lives in the error
 * registry, not here.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

/**
 * Read where the action is testing the agent: the Test agent menu item of the
 * agents page and the Test button of the agent drawer.
 */
export const OFFLINE_AGENT_TEST_COPY =
  "This agent is offline. Start the process that runs it to be able to test it.";

/**
 * Read where the action is choosing a run target: the run dialog target
 * picker, the scenario target selector and the Save and run menu.
 */
export const OFFLINE_AGENT_SELECT_COPY =
  "This agent is offline. Start the process that runs it to be able to select it.";
