/**
 * The scripted nlpgo boundary the dispatch suites run against.
 *
 * `vi.mock` factories are hoisted per module, so they cannot be imported and
 * every suite has to declare its own. What they do can be shared, which is
 * what this holds: the factories delegate here, and the suite reads the same
 * `scripted` object the boundary writes to.
 *
 * Nothing here may import the orchestrator, or any other module that reaches
 * the mocked post-event module. A mock factory awaits this file, so an import
 * that leads back to the module being mocked never settles and the run hangs
 * with no test output at all.
 */

import type { StudioServerEvent } from "@langwatch/workflow-contract";

/** What the boundary is told to answer, and what it was asked. */
export const scripted = {
  component: [] as StudioServerEvent[],
  dispatched: [] as Array<{ type: string; payload: Record<string, any> }>,
};

/** Stands in for `studioBackendPostEvent`: records the ask, replays the script. */
export const postEventToScript = async ({
  message,
  onEvent,
}: {
  message: { type: string; payload: Record<string, any> };
  onEvent: (event: StudioServerEvent) => void;
}): Promise<void> => {
  scripted.dispatched.push(message);
  for (const event of scripted.component) onEvent(event);
};

/** Stands in for env injection and dataset inlining, which are not under test. */
export const leaveEventAsItIs = async (event: unknown): Promise<unknown> =>
  event;

/** The dataset columns both suites resolve their mappings against. */
export const datasetColumns = [
  { id: "question", name: "question", type: "string" },
  { id: "expected", name: "expected", type: "string" },
];

/** Only the asks that were an evaluator run, in the order they were made. */
export const evaluatorDispatches = () =>
  scripted.dispatched.filter((message) => message.type === "execute_component");

/** Forget the previous test's script and its record of what was asked. */
export const resetBoundary = (): void => {
  scripted.component = [];
  scripted.dispatched = [];
};
