import type { PlanFlow, PlanStep } from "@langwatch/visual-diff-runner/protocol";
import { dump } from "js-yaml";

import type { Journey } from "./plan.ts";

/**
 * journeyFlow is a completed journey as a visualdiff flow: the start, every
 * step that worked, then the proof, read back from a reloaded page.
 */
export const journeyFlow = ({
  feature,
  journey,
  steps,
}: {
  feature: string;
  journey: Journey;
  steps: PlanStep[];
}): PlanFlow => ({
  id: `sim-${feature}-${journey.id}`,
  title: journey.goal,
  steps: [
    { action: "go", with: { path: journey.start } },
    ...steps,
    { action: "go", with: { path: journey.proof.path } },
    ...journey.proof.texts.map((text) => ({ action: "expect", with: { text } })),
  ],
});

/** flowFile is flows/<feature>.yaml in the shape tools/visualdiff/config.go loads. */
export const flowFile = ({ feature, flows }: { feature: string; flows: PlanFlow[] }): string =>
  `# ${feature}: journeys interactionsimulator completed, for a builder lane to adopt into
# tools/visualdiff/flows. Unreviewed: prefer test ids over the role selectors before adopting.
${dump({ flows }, { lineWidth: -1, noRefs: true })}`;
