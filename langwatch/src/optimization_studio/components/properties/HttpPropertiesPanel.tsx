import { Box, Field, HStack, Input, Tabs, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  AuthConfigSection,
  BodyTemplateEditor,
  HeadersConfigSection,
  HttpMethodSelector,
  HttpTestPanel,
  OutputPathInput,
} from "~/components/agents/http";
import {
  CODE_OUTPUT_TYPES,
  type Output,
  OutputsSection,
  type OutputType,
} from "~/components/outputs/OutputsSection";
import type { FieldMapping } from "~/components/variables";
import { type Variable, VariablesSection } from "~/components/variables";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  HttpAuth,
  HttpHeader,
  HttpMethod,
} from "~/optimization_studio/types/dsl";
import { api } from "~/utils/api";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, Field as DslField } from "../../types/dsl";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../utils/edgeMappingUtils";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

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
 * Uses the same tabbed layout and components as AgentHttpEditorDrawer:
 * Body / Auth / Headers / Test tabs, plus studio-specific input mappings.
 */
export function HttpPropertiesPanel({ node }: { node: Node<Component> }) {
  const { project } = useOrganizationTeamProject();
  const { nodes, edges, setNode, setNodeParameter, setEdges, getWorkflow } =
    useWorkflowStore(
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

  const [activeTab, setActiveTab] = useState("body");

  // Read HTTP config from parameters
  const url = (getParam(node.data.parameters, "url") as string) ?? "";
  const method = (getParam(node.data.parameters, "method") as HttpMethod) ?? "POST";
  const bodyTemplate = (getParam(node.data.parameters, "body_template") as string) ?? "";
  const outputPath = (getParam(node.data.parameters, "output_path") as string) ?? "";
  const auth = parseAuthFromParams(node.data.parameters);
  const headers = parseHeadersFromParams(node.data.parameters);

  // Convert node inputs/outputs
  const inputs: Variable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  const outputs: Output[] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
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
    (identifier: string, mapping: FieldMapping | undefined) => {
      const workflow = getWorkflow();
      const currentInputs =
        workflow.nodes.find((n) => n.id === node.id)?.data.inputs ?? [];
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

  const handleUrlChange = useCallback(
    (newUrl: string) => setParam("url", newUrl),
    [setParam],
  );

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
    (newVariables: Variable[]) => {
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
    (newOutputs: Output[]) => {
      const outputs: DslField[] = newOutputs.map((o) => ({
        identifier: o.identifier,
        type: o.type as DslField["type"],
      }));
      setNode({ id: node.id, data: { outputs } });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals],
  );

  // HTTP proxy mutation for testing
  const httpProxyMutation = api.httpProxy.execute.useMutation();

  const handleTest = useCallback(
    async (requestBody: string) => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
      }

      try {
        const result = await httpProxyMutation.mutateAsync({
          projectId: project.id,
          url,
          method,
          headers: headers.map((h) => ({ key: h.key, value: h.value })),
          auth: auth
            ? {
                type: auth.type,
                token: auth.type === "bearer" ? auth.token : undefined,
                headerName: auth.type === "api_key" ? auth.header : undefined,
                apiKeyValue: auth.type === "api_key" ? auth.value : undefined,
                username: auth.type === "basic" ? auth.username : undefined,
                password: auth.type === "basic" ? auth.password : undefined,
              }
            : undefined,
          body: requestBody,
          outputPath,
        });

        return {
          success: result.success,
          response: result.response,
          extractedOutput: result.extractedOutput,
          error: result.error,
          status: result.status,
          duration: result.duration,
          responseHeaders: result.responseHeaders,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Test request failed",
        };
      }
    },
    [project?.id, url, method, headers, auth, outputPath, httpProxyMutation],
  );

  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs paddingX={0}>
      {/* URL + Method */}
      <Box paddingX={4}>
        <VStack align="stretch" gap={2} width="full">
          <Text fontWeight="medium" fontSize="sm">
            Endpoint
          </Text>
          <HStack gap={2}>
            <HttpMethodSelector value={method} onChange={handleMethodChange} />
            <Input
              flex={1}
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://api.example.com/endpoint"
              fontFamily="mono"
              fontSize="13px"
              size="sm"
            />
          </HStack>
        </VStack>
      </Box>

      {/* Tabbed Content — same layout as AgentHttpEditorDrawer */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(e) => setActiveTab(e.value)}
        width="full"
        colorPalette="blue"
      >
        <Tabs.List
          paddingX={4}
          borderBottomWidth="1px"
          borderColor="border"
        >
          <Tabs.Trigger value="body">Body</Tabs.Trigger>
          <Tabs.Trigger value="auth">Auth</Tabs.Trigger>
          <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
          <Tabs.Trigger value="test">Test</Tabs.Trigger>
        </Tabs.List>

        {/* Body Tab */}
        <Tabs.Content value="body" paddingX={4} paddingY={3}>
          <VStack gap={4} align="stretch">
            <Field.Root>
              <Field.Label fontSize="sm">Request Body Template</Field.Label>
              <BodyTemplateEditor
                value={bodyTemplate}
                onChange={handleBodyTemplateChange}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="sm">Output Path (JSONPath)</Field.Label>
              <OutputPathInput value={outputPath} onChange={handleOutputPathChange} />
            </Field.Root>
          </VStack>
        </Tabs.Content>

        {/* Auth Tab */}
        <Tabs.Content value="auth" paddingX={4} paddingY={3}>
          <AuthConfigSection value={auth} onChange={handleAuthChange} />
        </Tabs.Content>

        {/* Headers Tab */}
        <Tabs.Content value="headers" paddingX={4} paddingY={3}>
          <HeadersConfigSection value={headers} onChange={handleHeadersChange} />
        </Tabs.Content>

        {/* Test Tab */}
        <Tabs.Content value="test" paddingX={4} paddingY={3}>
          <HttpTestPanel
            onTest={handleTest}
            url={url}
            method={method}
            headers={headers}
            outputPath={outputPath}
            bodyTemplate={bodyTemplate}
          />
        </Tabs.Content>
      </Tabs.Root>

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
