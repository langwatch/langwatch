import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorkflowPanelFieldMapping } from "./workflow-properties.ports";
import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/workflow-contract";
import { useWorkflowStore } from "../hooks/use-workflow-store";
import type { Component, Field as DslField } from "@langwatch/workflow-contract";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../utils/edge-mapping";
import type {
  WorkflowBasePropertiesPanelProps,
  WorkflowHttpConfigProps,
  WorkflowHttpTestConfig,
  WorkflowHttpTestResult,
  WorkflowOutputsProps,
  WorkflowVariablesProps,
  WorkflowVariable,
} from "./workflow-properties.ports";

const CODE_OUTPUT_TYPES: DslField["type"][] = ["str", "float", "bool", "dict", "list", "image"];

/**
 * Get a parameter value from the node's parameters array.
 */
function getParam(parameters: DslField[] | undefined, identifier: string): unknown {
  return parameters?.find((p) => p.identifier === identifier)?.value;
}

/**
 * Parse auth config from individual parameter fields into HttpAuth object.
 */
function parseAuthFromParams(parameters: DslField[] | undefined): HttpAuth | undefined {
  const authType = getParam(parameters, "auth_type") as string | undefined;
  if (!authType || authType === "none") return undefined;

  switch (authType) {
    case "bearer":
      return {
        type: "bearer",
        token: (getParam(parameters, "auth_token") as string) ?? "",
      };
    case "api_key":
      return {
        type: "api_key",
        header: (getParam(parameters, "auth_header") as string) ?? "",
        value: (getParam(parameters, "auth_value") as string) ?? "",
      };
    case "basic":
      return {
        type: "basic",
        username: (getParam(parameters, "auth_username") as string) ?? "",
        password: (getParam(parameters, "auth_password") as string) ?? "",
      };
    default:
      return undefined;
  }
}

/**
 * Parse headers from parameter field into HttpHeader array.
 */
function parseHeadersFromParams(parameters: DslField[] | undefined): HttpHeader[] {
  const raw = getParam(parameters, "headers");
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw)) return raw as HttpHeader[];
  // If stored as Record<string, string>, convert to array
  return Object.entries(raw as Record<string, string>).map(([key, value]) => ({
    key,
    value,
  }));
}

/**
 * Properties panel for HTTP Call nodes in the optimization studio.
 *
 * Uses the shared HttpConfigEditor for the endpoint + tabs UI,
 * plus studio-specific input mappings and outputs.
 */
export function HttpPropertiesPanel({
  node,
  renderBase: BasePropertiesPanel,
  renderHttpConfig: HttpConfigEditor,
  renderVariables: VariablesSection,
  renderOutputs: OutputsSection,
  onTest,
  useHttpTest,
}: {
  node: Node<Component>;
  renderBase: (props: WorkflowBasePropertiesPanelProps) => React.ReactNode;
  renderHttpConfig: (props: WorkflowHttpConfigProps) => React.ReactNode;
  renderVariables: (props: WorkflowVariablesProps) => React.ReactNode;
  renderOutputs: (props: WorkflowOutputsProps) => React.ReactNode;
  onTest?: (templateVariables: Record<string, unknown>) => Promise<WorkflowHttpTestResult>;
  useHttpTest: (config: WorkflowHttpTestConfig) => {
    handleTest: (templateVariables: Record<string, unknown>) => Promise<WorkflowHttpTestResult>;
  };
}) {
  const { nodes, edges, setNode, setNodeParameter, setEdges, getWorkflow } = useWorkflowStore(
    useShallow((state) => ({
      nodes: state.getWorkflow().nodes,
      edges: state.getWorkflow().edges,
      setNode: state.setNode,
      setNodeParameter: state.setNodeParameter,
      setEdges: state.setEdges,
      getWorkflow: state.getWorkflow,
    })),
  );
  const updateNodeInternals = useUpdateNodeInternals();

  // Read HTTP config from parameters
  const url = (getParam(node.data.parameters, "url") as string) ?? "";
  const method = (getParam(node.data.parameters, "method") as HttpMethod) ?? "POST";
  const bodyTemplate = (getParam(node.data.parameters, "body_template") as string) ?? "";
  const outputPath = (getParam(node.data.parameters, "output_path") as string) ?? "";
  const auth = parseAuthFromParams(node.data.parameters);
  const headers = parseHeadersFromParams(node.data.parameters);
  const test = useHttpTest({ url, method, headers, auth, outputPath, bodyTemplate });

  // Convert node inputs/outputs
  const inputs: WorkflowVariable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  const outputs: WorkflowOutputsProps["outputs"] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type,
  }));

  // Build mapping data from workflow graph
  const availableSources = useMemo(
    () => buildAvailableSources({ nodeId: node.id, nodes, edges }),
    [edges, nodes, node.id],
  );

  const inputMappings = useMemo(
    () =>
      buildInputMappings({
        nodeId: node.id,
        edges,
        inputs: node.data.inputs ?? [],
      }),
    [edges, node.id, node.data.inputs],
  );

  const handleMappingChange = useCallback(
    (identifier: string, mapping: WorkflowPanelFieldMapping | undefined) => {
      const workflow = getWorkflow();
      const currentInputs = workflow.nodes.find((n) => n.id === node.id)?.data.inputs ?? [];
      const result = applyMappingChange({
        nodeId: node.id,
        identifier,
        mapping,
        currentEdges: workflow.edges,
        currentInputs,
      });
      setEdges(result.edges);
      setNode({ id: node.id, data: { inputs: result.inputs } });
      updateNodeInternals(node.id);
    },
    [getWorkflow, node.id, setEdges, setNode, updateNodeInternals],
  );

  // Parameter change handlers
  const setParam = useCallback(
    (identifier: string, value: unknown) => {
      setNodeParameter(node.id, { identifier, type: "str", value });
    },
    [node.id, setNodeParameter],
  );

  const handleUrlChange = useCallback((newUrl: string) => setParam("url", newUrl), [setParam]);

  const handleMethodChange = useCallback(
    (newMethod: HttpMethod) => setParam("method", newMethod),
    [setParam],
  );

  const handleBodyTemplateChange = useCallback(
    (newBody: string) => setParam("body_template", newBody),
    [setParam],
  );

  const handleOutputPathChange = useCallback(
    (newPath: string) => setParam("output_path", newPath),
    [setParam],
  );

  const handleAuthChange = useCallback(
    (newAuth: HttpAuth | undefined) => {
      const auth = newAuth as Record<string, string> | undefined;
      setParam("auth_type", auth?.type ?? "none");
      setParam("auth_token", auth?.token ?? "");
      setParam("auth_header", auth?.header ?? "");
      setParam("auth_value", auth?.value ?? "");
      setParam("auth_username", auth?.username ?? "");
      setParam("auth_password", auth?.password ?? "");
    },
    [setParam],
  );

  const handleHeadersChange = useCallback(
    (newHeaders: HttpHeader[]) => {
      const headersDict = Object.fromEntries(
        newHeaders.filter((h) => h.key).map((h) => [h.key, h.value]),
      );
      setParam("headers", headersDict);
    },
    [setParam],
  );

  // Handle inputs change
  const handleInputsChange = useCallback(
    (newVariables: WorkflowVariable[]) => {
      const existingInputs = node.data.inputs ?? [];
      const newInputs: DslField[] = newVariables.map((v) => {
        const existing = existingInputs.find((i) => i.identifier === v.identifier);
        return {
          identifier: v.identifier,
          type: v.type as DslField["type"],
          ...(existing?.value != null ? { value: existing.value } : {}),
        };
      });
      setNode({ id: node.id, data: { inputs: newInputs } });
      updateNodeInternals(node.id);
    },
    [node.id, node.data.inputs, setNode, updateNodeInternals],
  );

  // Handle outputs change
  const handleOutputsChange = useCallback(
    (newOutputs: WorkflowOutputsProps["outputs"]) => {
      const outputs: DslField[] = newOutputs.map((o) => ({
        identifier: o.identifier,
        type: o.type as DslField["type"],
      }));
      setNode({ id: node.id, data: { outputs } });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals],
  );

  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs paddingX={0}>
      <HttpConfigEditor
        url={url}
        onUrlChange={handleUrlChange}
        method={method}
        onMethodChange={handleMethodChange}
        bodyTemplate={bodyTemplate}
        onBodyTemplateChange={handleBodyTemplateChange}
        outputPath={outputPath}
        onOutputPathChange={handleOutputPathChange}
        auth={auth}
        onAuthChange={handleAuthChange}
        headers={headers}
        onHeadersChange={handleHeadersChange}
        onTest={onTest ?? test.handleTest}
      />

      {/* Inputs with mappings */}
      <Box width="full" paddingX={4}>
        <VariablesSection
          variables={inputs}
          onChange={handleInputsChange}
          showMappings={true}
          mappings={inputMappings}
          onMappingChange={handleMappingChange}
          availableSources={availableSources}
          canAddRemove={true}
          readOnly={false}
          title="Inputs"
        />
      </Box>

      {/* Outputs */}
      <Box width="full" paddingX={4}>
        <OutputsSection
          outputs={outputs}
          onChange={handleOutputsChange}
          canAddRemove={true}
          readOnly={false}
          title="Outputs"
          availableTypes={CODE_OUTPUT_TYPES}
        />
      </Box>
    </BasePropertiesPanel>
  );
}
