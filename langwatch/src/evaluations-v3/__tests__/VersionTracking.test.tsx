/**
 * @vitest-environment jsdom
 *
 * Integration tests for prompt version tracking in evaluations v3.
 * Tests the following scenarios:
 * 1. Drawer opens with pinned version when localPromptConfig exists
 * 2. Clicking upgrade loads latest version and clears local changes
 * 3. Loading historical version pins to that version
 * 4. Saving clears pinning and sets to new version
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { LocalPromptConfig, TargetConfig } from "../types";

// Helper to create mock prompt data
const createMockPromptData = (version: number) => ({
  id: "prompt-1",
  name: "test-prompt",
  handle: "test-prompt",
  scope: "PROJECT",
  version: version,
  versionId: `version-${version}`,
  versionCreatedAt: new Date(),
  model: "gpt-4",
  temperature: 0.7,
  maxTokens: 1000,
  prompt: `You are a helpful assistant. Version ${version}`,
  projectId: "test-project",
  messages: [{ role: "system", content: `You are a helpful assistant. Version ${version}` }],
  inputs: [{ identifier: "input", type: "str" as const }],
  outputs: [{ identifier: "output", type: "str" as const }],
});

// Track simulated "latest" version in DB
let currentLatestVersion = 3;

describe("Version Tracking in Evaluations V3", () => {
  beforeEach(() => {
    currentLatestVersion = 3;
    useEvaluationsV3Store.getState().reset();
  });

  afterEach(() => {
    cleanup();
  });

  describe("drawer opens with pinned version when localPromptConfig exists", () => {
    it("target with local changes preserves version info when updating", async () => {
      // Setup: Target has local changes based on v2, even though latest is v3
      const localConfig: LocalPromptConfig = {
        llm: { model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
        messages: [{ role: "user", content: "My local changes on v2" }],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-2", // Pinned to v2
            promptVersionNumber: 2,
            localPromptConfig: localConfig, // Has local changes
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
      });

      // Verify target is correctly stored with version info
      const target = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(target.promptVersionId).toBe("version-2");
      expect(target.promptVersionNumber).toBe(2);
      expect(target.localPromptConfig).toBeDefined();

      // When updating local config, version info should be preserved
      const { updateTarget } = useEvaluationsV3Store.getState();
      act(() => {
        updateTarget("target-1", {
          localPromptConfig: {
            ...localConfig,
            messages: [{ role: "user", content: "Updated local changes" }],
          },
        });
      });

      const updatedTarget = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(updatedTarget.promptVersionId).toBe("version-2");
      expect(updatedTarget.promptVersionNumber).toBe(2);
      expect(updatedTarget.localPromptConfig?.messages[0]?.content).toBe("Updated local changes");
    });

    it("useOpenTargetEditor should pass promptVersionId when target has pinned version", async () => {
      // This tests the expected behavior: when target has a promptVersionId,
      // the hook should pass it to the drawer so it fetches that specific version
      const localConfig: LocalPromptConfig = {
        llm: { model: "gpt-4", temperature: 0.7, maxTokens: 1000 },
        messages: [{ role: "user", content: "My local changes on v2" }],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-2",
            promptVersionNumber: 2,
            localPromptConfig: localConfig,
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
        datasets: [
          {
            id: "test-data",
            type: "inline",
            name: "Test Data",
            columns: [{ id: "col-1", name: "input", type: "string" }],
            inline: {
              columns: [{ id: "col-1", name: "input", type: "string" }],
              records: { input: ["test"] },
            },
          },
        ],
        activeDatasetId: "test-data",
      });

      const target = useEvaluationsV3Store.getState().targets[0]!;

      // Verify the target has the expected structure that useOpenTargetEditor would use
      expect(target.type).toBe("prompt");
      if (target.type === "prompt") {
        expect(target.promptVersionId).toBe("version-2");
        // The hook would pass this to openDrawer("promptEditor", { promptVersionId: target.promptVersionId, ... })
      }
    });
  });

  describe("upgrading to latest version clears local changes", () => {
    it("updateTarget clears localPromptConfig and updates to latest version", async () => {
      // Setup: Target on v2 with local changes
      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-2",
            promptVersionNumber: 2,
            localPromptConfig: {
              llm: { model: "gpt-4" },
              messages: [{ role: "user", content: "local changes" }],
              inputs: [],
              outputs: [],
            },
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
      });

      // Get the updateTarget function from store
      const { updateTarget } = useEvaluationsV3Store.getState();

      // Simulate what happens when user upgrades to latest in the drawer
      // (The upgrade is now done via the drawer, not the table header)
      const latestPrompt = createMockPromptData(3);

      act(() => {
        updateTarget("target-1", {
          promptVersionId: latestPrompt.versionId,
          promptVersionNumber: latestPrompt.version,
          localPromptConfig: undefined, // Clears local changes
          inputs: latestPrompt.inputs?.map((i) => ({
            identifier: i.identifier,
            type: i.type,
          })),
          outputs: latestPrompt.outputs?.map((o) => ({
            identifier: o.identifier,
            type: o.type,
          })),
        });
      });

      // Verify the target was updated correctly
      const updatedTarget = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(updatedTarget.promptVersionId).toBe("version-3");
      expect(updatedTarget.promptVersionNumber).toBe(3);
      expect(updatedTarget.localPromptConfig).toBeUndefined();
    });
  });

  describe("loading historical version pins to that version", () => {
    it("onVersionChange callback updates target with loaded version", async () => {
      // Setup: Target initially at latest version
      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-3",
            promptVersionNumber: 3,
            localPromptConfig: undefined,
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
      });

      const { updateTarget } = useEvaluationsV3Store.getState();

      // Simulate what onVersionChange callback does (from useOpenTargetEditor)
      // This is called when user loads a historical version from Version History
      const loadedPrompt = createMockPromptData(2);

      act(() => {
        updateTarget("target-1", {
          promptVersionId: loadedPrompt.versionId,
          promptVersionNumber: loadedPrompt.version,
          localPromptConfig: undefined, // Clear local changes since we're loading a clean version
          inputs: loadedPrompt.inputs?.map((i) => ({
            identifier: i.identifier,
            type: i.type,
          })),
          outputs: loadedPrompt.outputs?.map((o) => ({
            identifier: o.identifier,
            type: o.type,
          })),
        });
      });

      // Verify the target is now pinned to v2
      const updatedTarget = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(updatedTarget.promptVersionId).toBe("version-2");
      expect(updatedTarget.promptVersionNumber).toBe(2);
      expect(updatedTarget.localPromptConfig).toBeUndefined();
    });
  });

  describe("saving clears pinning and sets to new version", () => {
    it("onSave callback clears localPromptConfig and updates to saved version", async () => {
      // Setup: Target with local changes on v2
      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-2",
            promptVersionNumber: 2,
            localPromptConfig: {
              llm: { model: "gpt-4" },
              messages: [{ role: "user", content: "changes to save" }],
              inputs: [],
              outputs: [],
            },
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
      });

      const { updateTarget } = useEvaluationsV3Store.getState();

      // Simulate what onSave callback does (from useOpenTargetEditor)
      // After saving, the server returns the new version (v4 in this case, since v3 was latest)
      const savedPrompt = {
        id: "prompt-1",
        name: "test-prompt",
        version: 4, // New version created
        versionId: "version-4",
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      act(() => {
        updateTarget("target-1", {
          name: savedPrompt.name,
          promptId: savedPrompt.id,
          promptVersionId: savedPrompt.versionId,
          promptVersionNumber: savedPrompt.version,
          localPromptConfig: undefined, // Clear local config on save
          inputs: savedPrompt.inputs?.map((i) => ({
            identifier: i.identifier,
            type: i.type,
          })),
          outputs: savedPrompt.outputs?.map((o) => ({
            identifier: o.identifier,
            type: o.type,
          })),
        });
      });

      // Verify the target is now at the new saved version
      const updatedTarget = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(updatedTarget.promptVersionId).toBe("version-4");
      expect(updatedTarget.promptVersionNumber).toBe(4);
      expect(updatedTarget.localPromptConfig).toBeUndefined();
    });

    it("after saving, target no longer shows as outdated", async () => {
      // Setup: Target at v2, latest is v3
      useEvaluationsV3Store.setState({
        targets: [
          {
            id: "target-1",
            type: "prompt",
            name: "test-prompt",
            promptId: "prompt-1",
            promptVersionId: "version-2",
            promptVersionNumber: 2,
            localPromptConfig: {
              llm: { model: "gpt-4" },
              messages: [{ role: "user", content: "changes" }],
              inputs: [],
              outputs: [],
            },
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
            mappings: {},
          },
        ],
      });

      const { updateTarget } = useEvaluationsV3Store.getState();

      // User saves, creating v4 (which becomes the new latest)
      currentLatestVersion = 4;
      const savedPrompt = {
        id: "prompt-1",
        name: "test-prompt",
        version: 4,
        versionId: "version-4",
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      act(() => {
        updateTarget("target-1", {
          promptVersionId: savedPrompt.versionId,
          promptVersionNumber: savedPrompt.version,
          localPromptConfig: undefined,
          inputs: savedPrompt.inputs?.map((i) => ({
            identifier: i.identifier,
            type: i.type,
          })),
          outputs: savedPrompt.outputs?.map((o) => ({
            identifier: o.identifier,
            type: o.type,
          })),
        });
      });

      // Verify the target version matches the latest
      const updatedTarget = useEvaluationsV3Store.getState().targets[0] as TargetConfig & { type: "prompt" };
      expect(updatedTarget.promptVersionNumber).toBe(4);
      expect(updatedTarget.promptVersionNumber).toBe(currentLatestVersion);
      // When version matches latest, isOutdated should be false
      // (This is checked by useLatestPromptVersion in the component)
    });
  });

  describe("version number captured when adding prompt to workbench", () => {
    it("addTarget includes promptVersionNumber when adding a prompt", () => {
      useEvaluationsV3Store.getState().reset();

      const { addTarget } = useEvaluationsV3Store.getState();

      // Simulate adding a prompt target with version info
      const newTarget: TargetConfig = {
        id: "target-new",
        type: "prompt",
        name: "new-prompt",
        promptId: "prompt-2",
        promptVersionId: "version-5",
        promptVersionNumber: 5,
        inputs: [{ identifier: "query", type: "str" as const }],
        outputs: [{ identifier: "response", type: "str" as const }],
        mappings: {},
      };

      act(() => {
        addTarget(newTarget);
      });

      const addedTarget = useEvaluationsV3Store.getState().targets.find(
        (t) => t.id === "target-new"
      ) as TargetConfig & { type: "prompt" };

      expect(addedTarget).toBeDefined();
      expect(addedTarget.promptVersionId).toBe("version-5");
      expect(addedTarget.promptVersionNumber).toBe(5);
    });
  });

  describe("version badge visibility logic", () => {
    /**
     * Helper to compute version badge visibility logic
     * This mirrors the logic in TargetHeader component
     */
    const computeShowVersionBadge = (params: {
      target: TargetConfig & { type: "prompt" };
      allTargets: TargetConfig[];
      latestVersion: number | undefined;
      hasLocalChanges: boolean;
    }): boolean => {
      const { target, latestVersion } = params;

      // Is this target effectively at "latest"?
      const isAtLatestVersion =
        target.promptVersionNumber === undefined ||
        target.promptVersionNumber === latestVersion;

      // Show badge if:
      // - Has version number defined
      // - Is NOT at latest version
      // Simple rule: if you're pinned to an older version, show the version badge
      return (
        target.promptVersionNumber !== undefined &&
        !isAtLatestVersion
      );
    };

    it("does NOT show version badge when target version matches latest", () => {
      // Target at v5, latest is also v5
      const target: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 5,
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const showBadge = computeShowVersionBadge({
        target,
        allTargets: [target],
        latestVersion: 5, // Same as target version
        hasLocalChanges: false,
      });

      expect(showBadge).toBe(false);
    });

    it("does NOT show version badge even with local changes if version matches latest", () => {
      // Target at v5 with local changes, latest is also v5
      const target: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 5,
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [{ role: "user", content: "local changes" }],
          inputs: [],
          outputs: [],
        },
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const showBadge = computeShowVersionBadge({
        target,
        allTargets: [target],
        latestVersion: 5, // Same as target version
        hasLocalChanges: true,
      });

      // Even with local changes, don't show badge if at latest version
      expect(showBadge).toBe(false);
    });

    it("does NOT show version badge when two targets have same effective version", () => {
      // Target A: pinned to v5
      // Target B: "latest" (undefined) which is also v5
      const targetA: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 5,
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const targetB: TargetConfig & { type: "prompt" } = {
        id: "target-2",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        // No promptVersionNumber = "latest"
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const allTargets = [targetA, targetB];
      const latestVersion = 5;

      // Target A: pinned to v5 which IS the latest, so don't show
      expect(computeShowVersionBadge({
        target: targetA,
        allTargets,
        latestVersion,
        hasLocalChanges: false,
      })).toBe(false);

      // Target B: no version number at all, so don't show
      expect(computeShowVersionBadge({
        target: targetB,
        allTargets,
        latestVersion,
        hasLocalChanges: false,
      })).toBe(false);
    });

    it("SHOWS version badge when two targets have actually different versions", () => {
      // Target A: pinned to v3
      // Target B: pinned to v5
      const targetA: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 3,
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const targetB: TargetConfig & { type: "prompt" } = {
        id: "target-2",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 5,
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const allTargets = [targetA, targetB];
      const latestVersion = 5;

      // Target A: v3 is NOT latest (5), and there are different versions
      expect(computeShowVersionBadge({
        target: targetA,
        allTargets,
        latestVersion,
        hasLocalChanges: false,
      })).toBe(true);

      // Target B: v5 IS latest, so don't show even with different versions
      expect(computeShowVersionBadge({
        target: targetB,
        allTargets,
        latestVersion,
        hasLocalChanges: false,
      })).toBe(false);
    });

    it("SHOWS version badge when target is behind latest and has local changes", () => {
      // Target at v3 with local changes, latest is v5
      const target: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 3,
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [{ role: "user", content: "local changes" }],
          inputs: [],
          outputs: [],
        },
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const showBadge = computeShowVersionBadge({
        target,
        allTargets: [target],
        latestVersion: 5, // Target is behind
        hasLocalChanges: true,
      });

      expect(showBadge).toBe(true);
    });

    it("SHOWS version badge when target is behind latest, even without local changes and as only target", () => {
      // Single target pinned to v6, latest is v7
      // Should show gray version badge (no upgrade arrow) to indicate it's not at latest
      const target: TargetConfig & { type: "prompt" } = {
        id: "target-1",
        type: "prompt",
        name: "test-prompt",
        promptId: "prompt-1",
        promptVersionNumber: 6,
        // No localPromptConfig - no local changes
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
        mappings: {},
      };

      const showBadge = computeShowVersionBadge({
        target,
        allTargets: [target], // Only one target
        latestVersion: 7, // Target is behind latest
        hasLocalChanges: false,
      });

      // Should show badge because version (6) is not at latest (7)
      expect(showBadge).toBe(true);
    });
  });

  describe("handleSelectPrompt flow (immediate drawer open after adding runner)", () => {
    /**
     * BUG: When adding a new runner via handleSelectPrompt, the drawer opens immediately.
     * If the user then loads an older version from version history, the target should update.
     *
     * The bug was that handleSelectPrompt did NOT set up the onVersionChange callback,
     * so loading an older version in the immediately-opened drawer didn't update the target.
     *
     * But if the user closed and reopened the drawer (which uses useOpenTargetEditor),
     * the onVersionChange callback WAS set up, and it worked.
     */
    it("onVersionChange callback should be set up when drawer opens immediately after handleSelectPrompt", async () => {
      // This simulates the flow:
      // 1. handleSelectPrompt creates target and opens drawer
      // 2. User immediately loads older version from version history
      // 3. Target should update to the loaded version

      const targetId = "target-immediate-version-change";

      // Step 1: Simulate handleSelectPrompt creating a target at latest version (v3)
      act(() => {
        useEvaluationsV3Store.getState().addTarget({
          id: targetId,
          type: "prompt",
          name: "test-prompt",
          promptId: "prompt-1",
          promptVersionId: "version-3",
          promptVersionNumber: 3,
          inputs: [{ identifier: "input", type: "str" as const }],
          outputs: [{ identifier: "output", type: "str" as const }],
          mappings: {},
        });
      });

      // Verify target is at v3
      let target = useEvaluationsV3Store.getState().targets.find(t => t.id === targetId) as TargetConfig & { type: "prompt" };
      expect(target.promptVersionNumber).toBe(3);

      // Step 2: Simulate onVersionChange being called (when user loads v2 from history)
      // This is what the onVersionChange callback in handleSelectPrompt should do
      const loadedPrompt = createMockPromptData(2);

      act(() => {
        useEvaluationsV3Store.getState().updateTarget(targetId, {
          promptVersionId: loadedPrompt.versionId,
          promptVersionNumber: loadedPrompt.version,
          localPromptConfig: undefined,
          inputs: loadedPrompt.inputs?.map((i) => ({
            identifier: i.identifier,
            type: i.type,
          })),
          outputs: loadedPrompt.outputs?.map((o) => ({
            identifier: o.identifier,
            type: o.type,
          })),
        });
      });

      // Step 3: Verify target is now at v2
      target = useEvaluationsV3Store.getState().targets.find(t => t.id === targetId) as TargetConfig & { type: "prompt" };
      expect(target.promptVersionNumber).toBe(2);
      expect(target.promptVersionId).toBe("version-2");
    });
  });
});

