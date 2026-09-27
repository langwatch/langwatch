import type { WireOf } from "@langwatch/api/web";
import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import type {
  ComparisonEvaluatorConfig,
  LocalEvaluatorConfig,
} from "@langwatch/experiment-contract";
import type { AvailableSource, FieldMapping } from "@langwatch/workflow-contract";

/** The evaluator categories evaluator's pickers group the evaluator types under. */
export type UiEvaluatorCategoryId = "expected_answer" | "llm_judge" | "rag" | "quality" | "safety";

/** The mapping context a caller opens evaluator's editors with. */
export type UiEvaluatorMappingsConfig = {
  level?: "trace" | "thread";
  availableSources?: AvailableSource[];
  initialMappings: Record<string, FieldMapping>;
  onMappingChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
};

/**
 * Whether a failing result of this evaluator fails what it is attached
 * to. A pass/fail evaluator can be required; a score-only evaluator
 * reports but never gates, so its switch stays off and disabled.
 */
export type UiEvaluatorGateConfig = {
  required: boolean;
  canRequire: boolean;
};

/** What a caller hands evaluator's editor drawer. */
export type UiEvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: {
    id: string;
    name: string;
    evaluatorType?: string;
  }) => boolean | undefined | Promise<void> | Promise<boolean>;
  evaluatorType?: string;
  evaluatorId?: string;
  category?: UiEvaluatorCategoryId;
  mappingsConfig?: UiEvaluatorMappingsConfig;
  saveButtonText?: string;
  onLocalConfigChange?: (config: LocalEvaluatorConfig | undefined) => void;
  onMappingChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
  /**
   * The gate of the attachment this evaluator is opened for. Present only
   * when the evaluator is attached to something that runs it after each
   * scenario, which is where a required pass or fail means anything.
   */
  gate?: UiEvaluatorGateConfig;
  /** Called when the required switch is flipped. Flows through setFlowCallbacks. */
  onRequiredChange?: (required: boolean) => void;
  /** Called when the attachment is taken off. Flows through setFlowCallbacks. */
  onRemove?: () => void;
  initialLocalConfig?: LocalEvaluatorConfig;
  /**
   * Comparison drawer context. Non-serializable; flows through complexProps.
   * When present, the drawer renders ComparisonConfigForm in place of the
   * per-row mappings section.
   */
  comparisonContext?: {
    initialComparison?: ComparisonEvaluatorConfig;
    targets: { id: string }[];
    datasetColumns: { id: string; name: string }[];
    /** Active dataset's name, used only to qualify column labels as
     * "Test Data.expected_output" — matching the mapping chips elsewhere. */
    datasetName?: string;
  };
};

/** What a caller hands evaluator's code evaluator editor drawer. */
export type UiCodeEvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  /** When set, the drawer edits this existing code evaluator instead of creating one. */
  evaluatorId?: string;
  /**
   * Workbench mapping context. When present, the inputs render with their
   * source mapping merged inline (like the prompt drawer); without it, the
   * inputs are a plain identifier + type list.
   */
  mappingsConfig?: UiEvaluatorMappingsConfig;
  onMappingChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
  /** Called with the saved evaluator; flow callbacks take precedence. */
  onSave?: (evaluator: { id: string; name: string }) => void;
  gate?: UiEvaluatorGateConfig;
  onRequiredChange?: (required: boolean) => void;
  onRemove?: () => void;
};

/** What a caller hands evaluator's list drawer; a picked row arrives as the browser receives it. */
export type UiEvaluatorListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (evaluator: WireOf<EvaluatorWithFields>) => void;
  onCreateNew?: () => void;
  filterEvaluatorType?: string;
  title?: string;
  createLabel?: string;
  itemLabel?: string;
};

/** What a caller hands evaluator's category selector drawer. */
export type UiEvaluatorCategorySelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelectCategory?: (category: UiEvaluatorCategoryId) => void;
  onSelectWorkflow?: () => void;
  onSelectCode?: () => void;
};

/** What a caller hands evaluator's drawer that creates a workflow-based evaluator. */
export type UiWorkflowSelectorForEvaluatorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: { id: string; name: string; workflowId: string }) => void;
  /** Name for the new evaluator (optional, prompts if not provided) */
  evaluatorName?: string;
};
