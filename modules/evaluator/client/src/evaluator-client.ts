/** The hooks Evaluator's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";
import { uiTokens } from "@langwatch/module";

type EvaluatorApiMap = ContractApiMap<typeof evaluatorTrpc>;

export const evaluatorClient: ModuleApi<EvaluatorApiMap> = createModuleApi<EvaluatorApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type EvaluatorInputs = { [K in keyof EvaluatorApiMap]: InputsOf<EvaluatorApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type EvaluatorOutputs = OutputsFromMap<EvaluatorApiMap>;

/** Evaluator UI lent by token to the studio's inline evaluator node (§10.1). */

/** What the studio hands evaluator's settings form for an inline evaluator node. */
export type EvaluatorSettingsFormProps = {
  evaluatorType: string;
  initialSettings: Record<string, unknown>;
  /** Fill in the evaluator's default settings on first render. */
  applyDefaults: boolean;
  onChange: (settings: Record<string, unknown>) => void;
};

export const EvaluatorSettingsFormToken =
  uiTokens("evaluator").component<EvaluatorSettingsFormProps>("evaluatorSettingsForm");

/** The kind of field a variable-mapping picker lists, as the workflow editor offers it. */
type EditorMappingFieldType =
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
type EditorMappingNestedField = {
  name: string;
  label?: string;
  type: EditorMappingFieldType;
  children?: EditorMappingNestedField[];
  getChildren?: () => EditorMappingNestedField[];
  isComplete?: boolean;
  isCompleteLabel?: string;
};

/** A place variables can be mapped from: a dataset or a workflow node. */
export type EvaluatorAvailableSource = {
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
  fields: EditorMappingNestedField[];
};

/** A variable's mapping: to a field of a source, or to a hardcoded value. */
export type EvaluatorFieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };

/** An evaluator's name and settings as the studio holds them. */
export type EvaluatorEditorValues = { name: string; settings: Record<string, unknown> };

/** What the studio hands evaluator's editor for one saved evaluator node. */
export type StudioEvaluatorEditorProps = {
  evaluatorType: string | undefined;
  description: string | undefined;
  isWorkflowEvaluator: boolean;
  workflow:
    | { id: string; name: string; icon?: string | null; updatedAt: string; projectSlug: string }
    | undefined;
  fields: { requiredFields?: string[]; optionalFields?: string[] } | undefined;
  initialValues: EvaluatorEditorValues;
  onChange: (values: EvaluatorEditorValues) => void;
  mappings: {
    availableSources: EvaluatorAvailableSource[];
    initialMappings: Record<string, EvaluatorFieldMapping>;
    onMappingChange: (identifier: string, mapping: EvaluatorFieldMapping | undefined) => void;
  };
};

export const StudioEvaluatorEditorToken =
  uiTokens("evaluator").component<StudioEvaluatorEditorProps>("studioEvaluatorEditor");
