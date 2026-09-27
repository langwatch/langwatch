import type { LocalPromptConfig } from "@langwatch/experiment-contract";
import type { AvailableSource, FieldMapping } from "@langwatch/workflow-contract";

/** What a caller hands prompt's editor drawer. */
export type UiPromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: { identifier: string; type: string }[];
    // json_schema flows to the target so structured outputs stay field-selectable
    // in the comparison config — see promptEditorCallbacks.onSave.
    outputs?: {
      identifier: string;
      type: string;
      json_schema?: object | null;
    }[];
  }) => void;
  /** If provided, loads an existing prompt for editing */
  promptId?: string;
  /**
   * If provided, fetches this specific version instead of the latest.
   * Used when editing a prompt that has local changes based on an older version.
   */
  promptVersionId?: string;
  /**
   * For evaluations context: callback to persist local changes when closing without save.
   * If provided, closing with unsaved changes will call this instead of showing a warning.
   * Pass undefined to clear local changes (when form matches saved state).
   */
  onLocalConfigChange?: (config: LocalPromptConfig | undefined) => void;
  /**
   * Initial local config to load (for resuming unpublished changes).
   */
  initialLocalConfig?: LocalPromptConfig;
  /**
   * Fallback config used ONLY when `promptId` is set but the prompt is not found in the
   * project (e.g. a workflow imported from another project).
   */
  inlineConfigFallback?: LocalPromptConfig;
  /**
   * Available sources for variable mapping (e.g., dataset columns).
   * When provided, shows mapping UI instead of simple value inputs.
   */
  availableSources?: AvailableSource[];
  /**
   * Current input mappings (managed by parent, e.g., evaluations store).
   */
  inputMappings?: Record<string, FieldMapping>;
  /**
   * Callback when input mappings change.
   */
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
  /**
   * Callback when a version is loaded from history (for evaluations context).
   * Called before the form is reset with the new version data.
   */
  onVersionChange?: (prompt: {
    version: number;
    versionId: string;
    inputs?: { identifier: string; type: string }[];
    outputs?: { identifier: string; type: string }[];
  }) => void;
  /** When true, renders form content without Drawer shell (for embedding in external drawer) */
  headless?: boolean;
};

/** What a caller hands prompt's list drawer. */
export type UiPromptListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: { identifier: string; type: string }[];
    outputs?: { identifier: string; type: string }[];
  }) => void;
  onCreateNew?: () => void;
};
