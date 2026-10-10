/** Prompt's editors the workflow studio and evaluator settings draw, by token (§10.1). */

import { uiTokens } from "@langwatch/module";

import type {
  PromptAvailableSource,
  PromptFieldMapping,
  PromptLocalConfig,
} from "./prompt-drawers.ts";

/** A field of a studio node, restated from workflow's shape so no edge is added. */
export type PromptStudioField = {
  identifier: string;
  type:
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
  optional?: boolean;
  value?: unknown;
  desc?: string;
  prefix?: string;
  hidden?: boolean;
  json_schema?: Record<string, unknown>;
};

/** The model settings a studio node holds, as the workflow stores them. */
export type PromptStudioLlmConfig = {
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  reasoning?: string;
  reasoning_effort?: string;
  thinkingLevel?: string;
  effort?: string;
  verbosity?: string;
  litellm_params?: Record<string, string>;
};

/** The parts of a studio signature node prompt's editor reads. */
export type PromptStudioNode = {
  name?: string;
  description?: string;
  parameters?: PromptStudioField[];
  inputs?: PromptStudioField[];
  outputs?: PromptStudioField[];
  llm?: PromptStudioLlmConfig;
  localPromptConfig?: PromptLocalConfig;
  promptId?: string;
  promptVersionId?: string;
  promptDraft?: boolean;
};

/** One declared output of a prompt, code or agent node. */
export type PromptNodeOutput = {
  identifier: string;
  type: PromptStudioField["type"];
  json_schema?: object;
};

/** One declared prompt input or output, as the prompt editor reports it. */
type PromptIOField = { identifier: string; type: string };

/** What the studio hands prompt's editor, embedded in a signature node's panel. */
export type StudioPromptEditorProps = {
  nodeData: PromptStudioNode;
  onClose: () => void;
  promptId: string | undefined;
  promptVersionId: string | undefined;
  initialLocalConfig: PromptLocalConfig | undefined;
  onLocalConfigChange: (config: PromptLocalConfig | undefined) => void;
  onSave: (prompt: {
    id: string;
    name: string;
    version?: number;
    versionId?: string;
    inputs?: PromptIOField[];
    outputs?: PromptIOField[];
  }) => void;
  onVersionChange: (prompt: {
    version: number;
    versionId: string;
    inputs?: PromptIOField[];
    outputs?: PromptIOField[];
  }) => void;
  availableSources: PromptAvailableSource[];
  inputMappings: Record<string, PromptFieldMapping>;
  onInputMappingsChange: (identifier: string, mapping: PromptFieldMapping | undefined) => void;
};

/** What a node panel hands prompt's outputs editor. */
export type OutputsSectionProps = {
  outputs: PromptNodeOutput[];
  onChange: (outputs: PromptNodeOutput[]) => void;
  canAddRemove?: boolean;
  readOnly?: boolean;
  title?: string;
  availableTypes?: PromptStudioField["type"][];
};

/** What a studio node hands prompt's LLM config row; prompt resolves the model option itself. */
export type LlmConfigFieldProps = {
  llmConfig: PromptStudioLlmConfig;
  onChange: (llmConfig: PromptStudioLlmConfig) => void;
  requiresCustomKey: boolean;
  showProviderKeyMessage?: boolean;
  outputs?: PromptNodeOutput[];
  onOutputsChange?: (outputs: PromptNodeOutput[]) => void;
  showStructuredOutputs?: boolean;
};

/** What an evaluator's settings hand prompt's LLM parameter popover. */
export type LlmConfigPopoverProps = {
  values: PromptStudioLlmConfig;
  onChange: (llmConfig: PromptStudioLlmConfig) => void;
  /** Models LangWatch serves itself, offered first even with no provider configured. */
  builtInModels?: readonly { value: string; label: string }[];
};

const prompt = uiTokens("prompt");

export const StudioPromptEditorToken =
  prompt.component<StudioPromptEditorProps>("studioPromptEditor");
export const OutputsSectionToken = prompt.component<OutputsSectionProps>("outputsSection");
export const LlmConfigFieldToken = prompt.component<LlmConfigFieldProps>("llmConfigField");
export const LlmConfigPopoverToken = prompt.component<LlmConfigPopoverProps>("llmConfigPopover");
