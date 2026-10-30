/**
 * The toast a save refused for carrying stored credentials to another origin shows.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { AgentStoredCredentialsDestinationError } from "@langwatch/agent-contract";
import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { describe, expect, it } from "vitest";

describe("a save refused for sending stored credentials to another origin", () => {
  /** @scenario "The agent form explains a hooks URL on another origin than the stored credentials" */
  it("names the Auth tab, where the token is typed again", () => {
    const copy = resolveUiFailureCopy({
      error: new AgentStoredCredentialsDestinationError(),
      fallbackTitle: "Couldn't save agent",
    });

    expect(copy.title).toBe("Stored credentials stay with the saved address");
    expect(copy.description).toContain("Type the auth token again on the Auth tab");
  });
});
