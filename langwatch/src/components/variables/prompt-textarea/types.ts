import type { BoxProps } from "@chakra-ui/react";
import type { AvailableSource } from "../VariableMappingInput";
import type { Variable } from "../VariablesSection";

export type PromptTextAreaOnAddMention = {
  value: string;
  display: string;
  startPos: number;
  endPos: number;
};

export type PromptTextAreaWithVariablesProps = {
  /** The prompt text value */
  value: string;
  /** Callback when text changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Available sources for variable insertion */
  availableSources?: AvailableSource[];
  /** Current variables defined in the prompt */
  variables?: Variable[];
  /** Callback when a new variable should be created */
  onCreateVariable?: (variable: Variable) => void;
  /** Callback when a variable mapping should be set */
  onSetVariableMapping?: (
    identifier: string,
    sourceId: string,
    field: string,
  ) => void;
  /** Whether the textarea is disabled */
  disabled?: boolean;
  /** Whether to show the "Add variable" button */
  showAddContextButton?: boolean;
  /** Minimum height */
  minHeight?: string;
  /** Maximum height */
  maxHeight?: string;
  /** Whether the field has an error (shows red border) */
  hasError?: boolean;
  /**
   * Legacy callback for optimization studio edge connections.
   * Called when a user selects a field from another node (otherNodesFields).
   * Returns the new handle name that was created (may differ from field if handle already exists).
   */
  onAddEdge?: (
    nodeId: string,
    field: string,
    content: PromptTextAreaOnAddMention,
  ) => string | void;
  /**
   * Legacy: fields from other nodes in optimization studio.
   * Each key is a nodeId, value is array of field names.
   */
  otherNodesFields?: Record<string, string[]>;
  /** Borderless mode for cleaner integration (e.g., in Messages mode) */
  borderless?: boolean;
  /** Whether to fill remaining height (only applies in borderless mode) */
  fillHeight?: boolean;
  /** Role identifier for focusing (e.g., "system" for system prompt) */
  role?: string;
} & Omit<BoxProps, "onChange">;

