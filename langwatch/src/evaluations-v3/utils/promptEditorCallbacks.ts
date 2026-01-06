/**
 * Helper to create type-safe prompt editor callbacks for evaluations-v3.
 *
 * This ensures we never forget a required callback when opening the prompt editor
 * for a target. If we add a new callback that all evaluations-v3 flows need,
 * we add it here and TypeScript will enforce it everywhere.
 */

import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import type { Field } from "~/optimization_studio/types/dsl";
import type {
  LocalPromptConfig,
  FieldMapping as StoreFieldMapping,
} from "../types";
import { convertFromUIMapping } from "./fieldMappingConverters";

/**
 * Parameters required to create prompt editor callbacks.
 * All fields are required to ensure we don't forget anything.
 */
export type CreatePromptEditorCallbacksParams = {
  targetId: string;
  updateTarget: (
    id: string,
    updates: {
      name?: string;
      promptId?: string;
      promptVersionId?: string;
      promptVersionNumber?: number;
      localPromptConfig?: LocalPromptConfig;
      inputs?: Array<{ identifier: string; type: Field["type"] }>;
      outputs?: Array<{ identifier: string; type: Field["type"] }>;
    },
  ) => void;
  setTargetMapping: (
    targetId: string,
    datasetId: string,
    inputIdentifier: string,
    mapping: StoreFieldMapping,
  ) => void;
  removeTargetMapping: (
    targetId: string,
    datasetId: string,
    inputIdentifier: string,
  ) => void;
  getActiveDatasetId: () => string;
  getDatasets: () => Array<{ id: string }>;
};

/**
 * Saved prompt data structure passed to onSave callback.
 * Note: versionId and version are optional to match the drawer callback type,
 * but we expect them to always be present when saving from evaluations-v3.
 */
export type SavedPromptData = {
  id: string;
  name: string;
  versionId?: string;
  version?: number;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
};

/**
 * Loaded version data structure passed to onVersionChange callback.
 */
export type LoadedVersionData = {
  version: number;
  versionId: string;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
};

/**
 * The callbacks object returned by createPromptEditorCallbacks.
 * All callbacks are required - this is what gets passed to setFlowCallbacks.
 */
export type PromptEditorCallbacksForTarget = {
  onLocalConfigChange: (localConfig: LocalPromptConfig | undefined) => void;
  onSave: (savedPrompt: SavedPromptData) => void;
  onVersionChange: (loadedPrompt: LoadedVersionData) => void;
  onInputMappingsChange: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
};

/**
 * Creates the standard set of prompt editor callbacks for a target in evaluations-v3.
 *
 * This helper ensures we always set up all required callbacks consistently.
 * If you need to add a new callback that all evaluations-v3 flows need,
 * add it here and TypeScript will enforce it everywhere.
 *
 * @example
 * ```ts
 * const callbacks = createPromptEditorCallbacks({
 *   targetId,
 *   updateTarget,
 *   setTargetMapping,
 *   removeTargetMapping,
 *   getActiveDatasetId: () => useEvaluationsV3Store.getState().activeDatasetId,
 *   getDatasets: () => useEvaluationsV3Store.getState().datasets,
 * });
 * setFlowCallbacks("promptEditor", callbacks);
 * ```
 */
export const createPromptEditorCallbacks = ({
  targetId,
  updateTarget,
  setTargetMapping,
  removeTargetMapping,
  getActiveDatasetId,
  getDatasets,
}: CreatePromptEditorCallbacksParams): PromptEditorCallbacksForTarget => ({
  onLocalConfigChange: (localConfig) => {
    // Only update localPromptConfig for tracking unsaved changes
    updateTarget(targetId, { localPromptConfig: localConfig });
  },

  onSave: (savedPrompt) => {
    updateTarget(targetId, {
      name: savedPrompt.name,
      promptId: savedPrompt.id,
      promptVersionId: savedPrompt.versionId,
      promptVersionNumber: savedPrompt.version,
      localPromptConfig: undefined, // Clear local config on save
      // Update inputs/outputs from saved prompt to keep validation working
      inputs: savedPrompt.inputs?.map((i) => ({
        identifier: i.identifier,
        type: i.type as Field["type"],
      })),
      outputs: savedPrompt.outputs?.map((o) => ({
        identifier: o.identifier,
        type: o.type as Field["type"],
      })),
    });
  },

  // Called when a version is loaded from history (before saving)
  onVersionChange: (loadedPrompt) => {
    // Update target to use the loaded version as new base
    updateTarget(targetId, {
      promptVersionId: loadedPrompt.versionId,
      promptVersionNumber: loadedPrompt.version,
      localPromptConfig: undefined, // Clear local changes since we're loading a clean version
      inputs: loadedPrompt.inputs?.map((i) => ({
        identifier: i.identifier,
        type: i.type as Field["type"],
      })),
      outputs: loadedPrompt.outputs?.map((o) => ({
        identifier: o.identifier,
        type: o.type as Field["type"],
      })),
    });
  },

  onInputMappingsChange: (identifier, mapping) => {
    // Get the current active dataset from store (it may have changed since drawer was opened)
    const currentActiveDatasetId = getActiveDatasetId();
    const currentDatasets = getDatasets();
    const checkIsDatasetSource = (sourceId: string) =>
      currentDatasets.some((d) => d.id === sourceId);

    if (mapping) {
      setTargetMapping(
        targetId,
        currentActiveDatasetId,
        identifier,
        convertFromUIMapping(mapping, checkIsDatasetSource),
      );
    } else {
      removeTargetMapping(targetId, currentActiveDatasetId, identifier);
    }
  },
});
