/**
 * @vitest-environment jsdom
 * The declared drawers ARE the registry the browser composes, so each name
 * the address bar may carry has to answer with a real component.
 */
import { installedDrawerLoaders } from "@langwatch/ui-kernel";
import { describe, expect, it } from "vitest";

import { agentWeb } from "../agent.web.ts";

const drawers = installedDrawerLoaders([agentWeb]);

describe("the agent browser declaration", () => {
  it("declares the drawer names the product's addresses already carry", () => {
    expect(Object.keys(drawers).toSorted()).toEqual([
      "agentCodeEditor",
      "agentConnectFromCode",
      "agentConnectedDetail",
      "agentHistory",
      "agentHttpEditor",
      "agentList",
      "agentTypeSelector",
      "agentVoiceEditor",
      "agentWorkflowEditor",
      "agentWorkflowTargetEditor",
      "workflowSelector",
    ]);
  });

  it.each(Object.keys(drawers))("loads a component for %s", async (drawer) => {
    const loaded = await drawers[drawer]?.();

    expect(typeof (loaded as { default?: unknown }).default).toBe("function");
  });
});
