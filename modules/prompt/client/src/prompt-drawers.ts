/** Prompt's drawers another module opens, by token (§10.1). */

import { uiTokens } from "@langwatch/module";

/** The kind of field a variable-mapping picker lists, as the workflow editor offers it. */
type MappingFieldType =
  | "str"
  | "image"
  | "file"
  | "float"
  | "int"
  | "bool"
  | "list"
  | "list[str]"
  | "list[float]"
  | "list[int]"
  | "list[bool]"
  | "dict"
  | "json_schema"
  | "chat_messages"
  | "signature"
  | "llm"
  | "prompting_technique"
  | "dataset"
  | "code";

/** A field selectable in the mapping dropdown, with static or lazily read children. */
type MappingNestedField = {
  name: string;
  label?: string;
  type: MappingFieldType;
  children?: MappingNestedField[];
  getChildren?: () => MappingNestedField[];
  isComplete?: boolean;
  isCompleteLabel?: string;
};

/** A place variables can be mapped from: a dataset or a workflow node. */
export type PromptAvailableSource = {
  id: string;
  name: string;
  type:
    | "entry"
    | "end"
    | "signature"
    | "code"
    | "retriever"
    | "prompting_technique"
    | "custom"
    | "evaluator"
    | "http"
    | "agent"
    | "if_else"
    | "dataset";
  fields: MappingNestedField[];
};

/** A variable's mapping: to a field of a source, or to a hardcoded value. */
export type PromptFieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };

/** Unpublished edits to a prompt that an experiment or workflow keeps beside the saved version. */
export type PromptLocalConfig = {
  llm: {
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    seed?: number;
    topK?: number;
    minP?: number;
    repetitionPenalty?: number;
    reasoning?: string;
    verbosity?: string;
    litellmParams?: Record<string, string>;
  };
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  inputs: {
    identifier: string;
    type:
      | "str"
      | "float"
      | "bool"
      | "image"
      | "file"
      | "list[str]"
      | "list[float]"
      | "list[int]"
      | "list[bool]"
      | "dict"
      | "list";
  }[];
  outputs: {
    identifier: string;
    type: "str" | "float" | "bool" | "json_schema";
    json_schema?: unknown;
  }[];
};

/** What a caller hands prompt's editor drawer. */
export type PromptEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (prompt: {
    id: string;
    name: string;
    version: number;
    versionId: string;
    inputs?: { identifier: string; type: string }[];
    // json_schema flows to the target so structured outputs stay field-selectable
    // in the comparison config.
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
  onLocalConfigChange?: (config: PromptLocalConfig | undefined) => void;
  /** Initial local config to load (for resuming unpublished changes). */
  initialLocalConfig?: PromptLocalConfig;
  /**
   * Fallback config used ONLY when `promptId` is set but the prompt is not found in the
   * project (e.g. a workflow imported from another project).
   */
  inlineConfigFallback?: PromptLocalConfig;
  /**
   * Available sources for variable mapping (e.g., dataset columns).
   * When provided, shows mapping UI instead of simple value inputs.
   */
  availableSources?: PromptAvailableSource[];
  /** Current input mappings (managed by parent, e.g., evaluations store). */
  inputMappings?: Record<string, PromptFieldMapping>;
  /** Callback when input mappings change. */
  onInputMappingsChange?: (identifier: string, mapping: PromptFieldMapping | undefined) => void;
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
export type PromptListDrawerProps = {
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

const tokens = uiTokens("prompt");

export const PromptEditorDrawerToken = tokens.drawer<PromptEditorDrawerProps>("promptEditor");
export const PromptListDrawerToken = tokens.drawer<PromptListDrawerProps>("promptList");
