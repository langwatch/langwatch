/**
 * @vitest-environment jsdom
 * Workflow lends its components by the tokens in its client package, so a reader
 * renders them without importing workflow's browser package (§10.1).
 */
import {
  HoverableBigTextToken,
  RedactedFieldToken,
  RunExperimentViaApiDialogToken,
  VersionBoxToken,
} from "@langwatch/workflow-client";
import { describe, expect, it } from "vitest";

import { workflowWeb } from "../workflow.web.ts";

async function loadLent({ key }: { key: string }) {
  const lend = workflowWeb.installation.lends.find(({ token }) => token.key === key);
  return lend && "load" in lend ? lend.load() : undefined;
}

describe("the workflow browser declaration", () => {
  describe("when a reader looks up each token from workflow's client", () => {
    /** @scenario Each wave 2 owner lends its components by its client tokens */
    it.each([
      HoverableBigTextToken,
      RedactedFieldToken,
      RunExperimentViaApiDialogToken,
      VersionBoxToken,
    ])("loads the lent component for $key", async (token) => {
      const loaded = await loadLent(token);

      expect(loaded).toHaveProperty("default");
    });
  });
});
