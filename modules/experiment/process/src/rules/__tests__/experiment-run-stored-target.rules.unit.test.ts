/**
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 */
import { experimentRunTargetSchema } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { runTargetFromStored, storedRunTargetOf } from "../experiment-run-stored-target.rules.ts";

const pinned = {
  id: "target-agent",
  name: "refund-bot",
  type: "agent",
  agentId: "agent-1",
  agentLabel: "production",
  agentVersion: 3,
};

/** The run target schema a release before label versions shipped with. */
const previousReleaseTargetSchema = experimentRunTargetSchema
  .omit({ agentLabel: true, agentVersion: true })
  .strict();

describe("a run target's stored shape", () => {
  describe("given a target pinned to production at version 3", () => {
    /** @scenario "A release before label versions still reads the targets of a run that recorded one" */
    it("is accepted by the previous release's strict target schema", () => {
      const stored = storedRunTargetOf(pinned);

      expect(previousReleaseTargetSchema.safeParse(stored).success).toBe(true);
    });

    /** @scenario "A release before label versions still reads the targets of a run that recorded one" */
    it("reads back with the label and version at the top level", () => {
      const read = runTargetFromStored(storedRunTargetOf(pinned));

      expect(experimentRunTargetSchema.parse(read)).toEqual(pinned);
    });
  });

  describe("given a target with metadata of its own and no label", () => {
    it("keeps the target as it was", () => {
      const target = { id: "t", name: "n", type: "prompt", metadata: { temperature: 0.2 } };

      expect(runTargetFromStored(storedRunTargetOf(target))).toEqual(target);
    });
  });
});
