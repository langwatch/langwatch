/**
 * Every read of an agent follows its writes through a read hint, never a reload.
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { describe, expect, it } from "vitest";

import { agentTrpc } from "../agent.trpc.ts";
import { AGENT_ARCHIVED_EVENT_TYPE, AGENT_CHANGED_EVENT_TYPE } from "../agent.ts";

const READS = ["getAll", "getById", "getCopies", "getHistory", "listVersions"] as const;

const hintsOf = (name: (typeof READS)[number]) =>
  (agentTrpc.members[name].invalidatedBy ?? []).map((hint) =>
    typeof hint === "string" ? hint : hint.event,
  );

describe("the agent reads", () => {
  /** @scenario "Every read of an agent goes stale when the agent changes or is archived" */
  it.each(READS)("%s goes stale when an agent changes or is archived", (name) => {
    expect(hintsOf(name)).toEqual([AGENT_CHANGED_EVENT_TYPE, AGENT_ARCHIVED_EVENT_TYPE]);
  });
});
