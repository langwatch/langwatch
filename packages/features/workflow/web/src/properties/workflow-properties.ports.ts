import type {
  ComponentType as WorkflowComponentType,
  Field,
  HttpAuth,
  HttpHeader,
  HttpMethod,
} from "@langwatch/workflow-contract";
import { WorkflowBasePropertiesPanel } from "../workflow-base-properties-panel";

export type WorkflowVariable = { identifier: string; type: Field["type"] };

export type WorkflowVariablesProps = {
  variables: WorkflowVariable[];
  onChange: (variables: WorkflowVariable[]) => void;
  mappings?: Record<string, WorkflowPanelFieldMapping>;
  onMappingChange?: (identifier: string, mapping: WorkflowPanelFieldMapping | undefined) => void;
  availableSources?: WorkflowPanelMappingSource[];
  values?: Record<string, string>;
  onValueChange?: (identifier: string, value: string) => void;
  showMappings?: boolean;
  canAddRemove?: boolean;
  readOnly?: boolean;
  title?: string;
  isMappingDisabled?: boolean;
};

export type WorkflowPanelFieldMapping =
  | { type: "source"; sourceId: string; path: string[] }
  | { type: "value"; value: string };

export type WorkflowPanelMappingSource = {
  id: string;
  name: string;
  type: WorkflowComponentType | "dataset";
  fields: Array<{ name: string; type: Field["type"] }>;
};

export type WorkflowOutputsProps = {
  outputs: Array<{ identifier: string; type: Field["type"]; json_schema?: object }>;
  onChange: (
    outputs: Array<{ identifier: string; type: Field["type"]; json_schema?: object }>,
  ) => void;
  canAddRemove?: boolean;
  readOnly?: boolean;
  title?: string;
  availableTypes?: Field["type"][];
};

export type WorkflowCodeEditorProps = {
  code: string;
  onChange: (code: string) => void;
  language?: string;
  inputs?: readonly { identifier: string; type: string }[];
  outputs?: readonly { identifier: string; type: string }[];
  viewStateKey?: string;
};

export type WorkflowHttpConfigProps = {
  url: string;
  onUrlChange: (url: string) => void;
  method: HttpMethod;
  onMethodChange: (method: HttpMethod) => void;
  bodyTemplate: string;
  onBodyTemplateChange: (body: string) => void;
  outputPath: string;
  onOutputPathChange: (path: string) => void;
  auth: HttpAuth | undefined;
  onAuthChange: (auth: HttpAuth | undefined) => void;
  headers: HttpHeader[];
  onHeadersChange: (headers: HttpHeader[]) => void;
  onTest: (templateVariables: Record<string, unknown>) => Promise<WorkflowHttpTestResult>;
};

export type WorkflowHttpTestResult = {
  success: boolean;
  response?: unknown;
  extractedOutput?: string;
  error?: string;
  errorCode?: string;
  status?: number;
  statusText?: string;
  duration?: number;
  responseHeaders?: Record<string, string>;
  renderedBody?: string;
  warnings?: string[];
};

export type WorkflowHttpTestConfig = Pick<
  WorkflowHttpConfigProps,
  "url" | "method" | "headers" | "auth" | "outputPath" | "bodyTemplate"
>;

export type WorkflowBasePropertiesPanelProps = React.ComponentProps<
  typeof WorkflowBasePropertiesPanel
>;
