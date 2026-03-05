import {
  Badge,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";

import {
  HttpConfigEditor,
  useHttpTest,
} from "~/components/agents/http";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import {
  CODE_OUTPUT_TYPES,
  type Output,
  OutputsSection,
  type OutputType,
} from "~/components/outputs/OutputsSection";
import type { FieldMapping } from "~/components/variables";
import { type Variable, VariablesSection } from "~/components/variables";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { AgentComponentConfig } from "~/server/agents/agent.repository";
import type {
  HttpAuth,
  HttpHeader,
  HttpMethod,
  HttpComponentConfig,
  CodeComponentConfig,
} from "~/optimization_studio/types/dsl";
import { api } from "~/utils/api";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { AgentComponent, Field as DslField } from "../../types/dsl";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../utils/edgeMappingUtils";
import { useRegisterDrawerFooter } from "../drawers/useInsideDrawer";
import { CodeEditorModal } from "../code/CodeEditorModal";
import { BasePropertiesPanel } from "./BasePropertiesPanel";

/**
 * Checks whether the agent string uses the DB-backed format (`agents/<id>`).
 */
function isDbAgentRef(agent: string | undefined): boolean {
  return !!agent?.startsWith("agents/");
}

/**
 * Extracts the agent DB ID from an `agents/<id>` reference.
 */
function extractAgentId(agent: string): string {
  return agent.replace("agents/", "");
}

// ---------------------------------------------------------------------------
// HTTP Config helpers
// ---------------------------------------------------------------------------

function getHttpConfig(config: AgentComponentConfig): HttpComponentConfig {
  return config as HttpComponentConfig;
}

function buildHttpConfig(
  url: string,
  method: HttpMethod,
  bodyTemplate: string,
  outputPath: string,
  headers: HttpHeader[],
  auth: HttpAuth | undefined,
): HttpComponentConfig {
  return {
    name: "HTTP",
    description: "HTTP API endpoint",
    url,
    method,
    bodyTemplate,
    outputPath,
    headers: headers.length > 0 ? headers : undefined,
    auth: auth?.type === "none" ? undefined : auth,
  };
}

// ---------------------------------------------------------------------------
// Code Config helpers
// ---------------------------------------------------------------------------

const DEFAULT_CODE = `import dspy

class Code(dspy.Module):
    def forward(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

function getCodeFromConfig(config: AgentComponentConfig): string {
  const codeConfig = config as CodeComponentConfig;
  const codeParam = codeConfig.parameters?.find(
    (p) => p.identifier === "code" && p.type === "code",
  );
  return (codeParam?.value as string) ?? DEFAULT_CODE;
}

function getInputsFromConfig(config: AgentComponentConfig): DslField[] {
  const codeConfig = config as CodeComponentConfig;
  return codeConfig.inputs ?? [{ identifier: "input", type: "str" }];
}

function getOutputsFromConfig(config: AgentComponentConfig): DslField[] {
  const codeConfig = config as CodeComponentConfig;
  return codeConfig.outputs ?? [{ identifier: "output", type: "str" }];
}

function buildCodeConfig(
  code: string,
  inputs: DslField[],
  outputs: DslField[],
): CodeComponentConfig {
  return {
    name: "Code",
    description: "Python code block",
    parameters: [{ identifier: "code", type: "code", value: code }],
    inputs: inputs as CodeComponentConfig["inputs"],
    outputs: outputs as CodeComponentConfig["outputs"],
  };
}

// ---------------------------------------------------------------------------
// Entry component
// ---------------------------------------------------------------------------

/**
 * Properties panel for agent nodes in the optimization studio.
 * Renders agent configuration inline (HTTP tabs or code editor),
 * matching the pattern used by EvaluatorPropertiesPanel.
 */
export function AgentPropertiesPanel({
  node,
}: {
  node: Node<AgentComponent>;
}) {
  const agentRef = node.data.agent;

  if (isDbAgentRef(agentRef)) {
    return <DbAgentPanel node={node} agentRef={agentRef!} />;
  }

  return <BasePropertiesPanel node={node} />;
}

// ---------------------------------------------------------------------------
// DB-backed Agent Panel
// ---------------------------------------------------------------------------

function DbAgentPanel({
  node,
  agentRef,
}: {
  node: Node<AgentComponent>;
  agentRef: string;
}) {
  const { project } = useOrganizationTeamProject();
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodes, edges, setNode, setEdges, getWorkflow, deselectAllNodes } =
    useWorkflowStore(
      useShallow(({ setNode, setEdges, getWorkflow, deselectAllNodes }) => ({
        nodes: getWorkflow().nodes,
        edges: getWorkflow().edges,
        setNode,
        setEdges,
        getWorkflow,
        deselectAllNodes,
      })),
    );

  const agentId = extractAgentId(agentRef);

  const agentQuery = api.agents.getById.useQuery(
    { id: agentId, projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const updateMutation = api.agents.update.useMutation();

  const agentData = agentQuery.data;
  const agentType = agentData?.type;
  const dbName = agentData?.name ?? "";
  const dbConfig = agentData?.config;

  // Local config from node data (unsaved changes)
  const localConfig = node.data.localConfig;

  // Form for name
  const form = useForm<{ name: string }>({
    defaultValues: { name: localConfig?.name ?? dbName },
  });

  // Reset form when agent data loads
  useEffect(() => {
    if (agentData) {
      form.reset({
        name: node.data.localConfig?.name ?? agentData.name,
      });
    }
  }, [agentData, form]);

  // ---- HTTP state ----
  const httpConfig = agentType === "http" && dbConfig
    ? getHttpConfig(dbConfig)
    : undefined;
  const localSettings = localConfig?.settings as Record<string, unknown> | undefined;

  const [url, setUrl] = useState(
    (localSettings?.url as string) ?? httpConfig?.url ?? "",
  );
  const [method, setMethod] = useState<HttpMethod>(
    (localSettings?.method as HttpMethod) ?? httpConfig?.method ?? "POST",
  );
  const [bodyTemplate, setBodyTemplate] = useState(
    (localSettings?.bodyTemplate as string) ?? httpConfig?.bodyTemplate ?? "",
  );
  const [outputPath, setOutputPath] = useState(
    (localSettings?.outputPath as string) ?? httpConfig?.outputPath ?? "",
  );
  const [headers, setHeaders] = useState<HttpHeader[]>(
    (localSettings?.headers as HttpHeader[]) ?? httpConfig?.headers ?? [],
  );
  const [auth, setAuth] = useState<HttpAuth | undefined>(
    (localSettings?.auth as HttpAuth) ?? httpConfig?.auth ?? { type: "none" },
  );
  // ---- Code state ----
  const codeConfig = agentType === "code" && dbConfig ? dbConfig : undefined;
  const [code, setCode] = useState(
    (localSettings?.code as string) ??
      (codeConfig ? getCodeFromConfig(codeConfig) : DEFAULT_CODE),
  );
  const [codeInputs, setCodeInputs] = useState<DslField[]>(
    (localSettings?.codeInputs as DslField[]) ??
      (codeConfig ? getInputsFromConfig(codeConfig) : [{ identifier: "input", type: "str" }]),
  );
  const [codeOutputs, setCodeOutputs] = useState<DslField[]>(
    (localSettings?.codeOutputs as DslField[]) ??
      (codeConfig ? getOutputsFromConfig(codeConfig) : [{ identifier: "output", type: "str" }]),
  );
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  // Reset state when agent data changes
  useEffect(() => {
    if (agentData && !localConfig?.settings) {
      if (agentData.type === "http") {
        const config = getHttpConfig(agentData.config);
        setUrl(config.url || "");
        setMethod(config.method ?? "POST");
        setBodyTemplate(config.bodyTemplate ?? "");
        setOutputPath(config.outputPath ?? "");
        setHeaders(config.headers ?? []);
        setAuth(config.auth ?? { type: "none" });
      } else if (agentData.type === "code") {
        setCode(getCodeFromConfig(agentData.config));
        setCodeInputs(getInputsFromConfig(agentData.config));
        setCodeOutputs(getOutputsFromConfig(agentData.config));
      }
    }
  }, [agentData, localConfig?.settings]);

  // Debounced persist of config changes to localConfig
  const persistLocalSettings = useDebouncedCallback(
    (settings: Record<string, unknown>) => {
      setNode({
        id: node.id,
        data: {
          localConfig: {
            name: form.getValues("name"),
            settings,
          },
        },
      });
    },
    300,
    { trailing: true },
  );

  // Watch name changes
  const debouncedSetLocalConfig = useDebouncedCallback(
    (formValues: { name?: string }) => {
      const nameChanged = formValues.name !== dbName;
      if (nameChanged) {
        setNode({
          id: node.id,
          data: {
            localConfig: {
              name: formValues.name as string,
              settings: localConfig?.settings,
            },
          },
        });
      } else if (!localConfig?.settings) {
        setNode({ id: node.id, data: { localConfig: undefined } });
      }
    },
    300,
    { trailing: true },
  );

  useEffect(() => {
    const subscription = form.watch((formValues) => {
      if (formValues.name !== undefined) {
        debouncedSetLocalConfig(formValues);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, debouncedSetLocalConfig]);

  const handleUrlChange = useCallback((newUrl: string) => setUrl(newUrl), []);
  const handleMethodChange = useCallback((newMethod: HttpMethod) => setMethod(newMethod), []);
  const handleBodyTemplateChange = useCallback((newBody: string) => setBodyTemplate(newBody), []);
  const handleOutputPathChange = useCallback((newPath: string) => setOutputPath(newPath), []);
  const handleAuthChange = useCallback((newAuth: HttpAuth | undefined) => setAuth(newAuth), []);
  const handleHeadersChange = useCallback((newHeaders: HttpHeader[]) => setHeaders(newHeaders), []);

  // Track HTTP changes for localConfig persistence
  useEffect(() => {
    if (agentType !== "http" || !agentData) return;
    const dbCfg = getHttpConfig(agentData.config);
    const changed =
      url !== (dbCfg.url || "") ||
      method !== (dbCfg.method ?? "POST") ||
      bodyTemplate !== (dbCfg.bodyTemplate ?? "") ||
      outputPath !== (dbCfg.outputPath ?? "") ||
      JSON.stringify(headers) !== JSON.stringify(dbCfg.headers ?? []) ||
      JSON.stringify(auth) !== JSON.stringify(dbCfg.auth ?? { type: "none" });

    if (changed) {
      persistLocalSettings({ url, method, bodyTemplate, outputPath, headers, auth });
    }
  }, [url, method, bodyTemplate, outputPath, headers, auth, agentType, agentData, persistLocalSettings]);

  // Track Code changes for localConfig persistence
  useEffect(() => {
    if (agentType !== "code" || !agentData) return;
    const dbCode = getCodeFromConfig(agentData.config);
    const dbInputs = getInputsFromConfig(agentData.config);
    const dbOutputs = getOutputsFromConfig(agentData.config);
    const changed =
      code !== dbCode ||
      JSON.stringify(codeInputs) !== JSON.stringify(dbInputs) ||
      JSON.stringify(codeOutputs) !== JSON.stringify(dbOutputs);

    if (changed) {
      persistLocalSettings({ code, codeInputs, codeOutputs });
    }
  }, [code, codeInputs, codeOutputs, agentType, agentData, persistLocalSettings]);

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

  const handleInputMappingChange = useCallback(
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

  // Convert inputs/outputs for VariablesSection / OutputsSection
  const inputs: Variable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  const outputs: Output[] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
  }));

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

  const handleOutputsChange = useCallback(
    (newOutputs: Output[]) => {
      const mapped: DslField[] = newOutputs.map((o) => ({
        identifier: o.identifier,
        type: o.type as DslField["type"],
      }));
      setNode({ id: node.id, data: { outputs: mapped } });
      updateNodeInternals(node.id);
    },
    [node.id, setNode, updateNodeInternals],
  );

  // Action handlers
  const handleApply = useCallback(() => deselectAllNodes(), [deselectAllNodes]);

  const handleSave = useCallback(() => {
    if (!project?.id || !agentData) return;
    const formValues = form.getValues();

    let config: AgentComponentConfig | undefined;
    if (agentType === "http") {
      config = buildHttpConfig(url, method, bodyTemplate, outputPath, headers, auth);
    } else if (agentType === "code") {
      config = buildCodeConfig(code, codeInputs, codeOutputs);
    }

    updateMutation.mutate(
      {
        id: agentId,
        projectId: project.id,
        name: formValues.name.trim(),
        ...(config ? { config } : {}),
      },
      {
        onSuccess: () =>
          setNode({ id: node.id, data: { localConfig: undefined } }),
      },
    );
  }, [
    project?.id,
    agentId,
    agentData,
    agentType,
    form,
    url,
    method,
    bodyTemplate,
    outputPath,
    headers,
    auth,
    code,
    codeInputs,
    codeOutputs,
    updateMutation,
    setNode,
    node.id,
  ]);

  const handleDiscard = useCallback(() => {
    debouncedSetLocalConfig.cancel();
    persistLocalSettings.cancel();
    form.reset({ name: dbName });
    // Reset agent config state from DB
    if (agentData?.type === "http") {
      const config = getHttpConfig(agentData.config);
      setUrl(config.url || "");
      setMethod(config.method ?? "POST");
      setBodyTemplate(config.bodyTemplate ?? "");
      setOutputPath(config.outputPath ?? "");
      setHeaders(config.headers ?? []);
      setAuth(config.auth ?? { type: "none" });
    } else if (agentData?.type === "code") {
      setCode(getCodeFromConfig(agentData.config));
      setCodeInputs(getInputsFromConfig(agentData.config));
      setCodeOutputs(getOutputsFromConfig(agentData.config));
    }
    setNode({ id: node.id, data: { localConfig: undefined } });
  }, [
    form,
    dbName,
    agentData,
    setNode,
    node.id,
    debouncedSetLocalConfig,
    persistLocalSettings,
  ]);

  const hasLocalChanges = !!localConfig;

  // HTTP test via shared hook
  const { handleTest } = useHttpTest({ url, method, headers, auth, outputPath });

  // Register footer
  const footerContent = useMemo(
    () => (
      <HStack width="full">
        {hasLocalChanges && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscard}
            data-testid="agent-discard-button"
          >
            Discard
          </Button>
        )}
        <Spacer />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          loading={updateMutation.isPending}
          data-testid="agent-save-button"
        >
          Save
        </Button>
        <Button
          colorPalette="blue"
          size="sm"
          onClick={handleApply}
          data-testid="agent-apply-button"
        >
          Apply
        </Button>
      </HStack>
    ),
    [
      hasLocalChanges,
      handleDiscard,
      handleApply,
      handleSave,
      updateMutation.isPending,
    ],
  );
  useRegisterDrawerFooter(footerContent);

  if (agentQuery.isLoading) {
    return (
      <HStack justify="center" paddingY={8} width="full">
        <Spinner size="md" />
      </HStack>
    );
  }

  const typeBadge =
    agentType === "http"
      ? "HTTP"
      : agentType === "code"
        ? "Code"
        : agentType === "workflow"
          ? "Workflow"
          : "Agent";

  return (
    <BasePropertiesPanel node={node} hideParameters hideInputs hideOutputs paddingX={0}>
      {/* Agent name + type badge */}
      <VStack align="stretch" gap={2} width="full" paddingX={4}>
        <HStack>
          <Text fontWeight="medium" fontSize="sm">
            Name
          </Text>
          <Spacer />
          <Badge colorPalette="purple" size="sm">
            {typeBadge}
          </Badge>
        </HStack>
        <Input
          {...form.register("name")}
          size="sm"
          placeholder="Agent name"
        />
      </VStack>

      {/* Inline HTTP editor */}
      {agentType === "http" && (
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
          onTest={handleTest}
        />
      )}

      {/* Inline Code editor */}
      {agentType === "code" && (
        <VStack gap={4} align="stretch" paddingX={4} width="full">
          <Field.Root>
            <Field.Label fontSize="sm">Python Code</Field.Label>
            <Text fontSize="xs" color="fg.muted" marginBottom={1}>
              Write a DSPy module that takes inputs and returns outputs.
            </Text>
            <CodeBlockEditor
              code={code}
              onChange={(v) => setCode(v)}
              language="python"
              externalModal
              onEditClick={() => setIsCodeModalOpen(true)}
            />
          </Field.Root>
        </VStack>
      )}

      {agentType === "workflow" && (
        <Box paddingX={4}>
          <Text fontSize="sm" color="fg.muted">
            This agent is backed by a workflow. Edit the workflow in Studio to
            modify its behavior.
          </Text>
        </Box>
      )}

      {/* Inputs with mappings */}
      <Box width="full" paddingX={4}>
        <VariablesSection
          variables={inputs}
          onChange={handleInputsChange}
          showMappings={true}
          mappings={inputMappings}
          onMappingChange={handleInputMappingChange}
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

      {/* Code editor modal (outside drawer to avoid focus conflicts) */}
      {agentType === "code" && (
        <CodeEditorModal
          code={code}
          setCode={(v) => setCode(v)}
          open={isCodeModalOpen}
          onClose={() => setIsCodeModalOpen(false)}
        />
      )}
    </BasePropertiesPanel>
  );
}
