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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";

import { HttpConfigEditor, useHttpTest } from "~/components/agents/http";
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
import type {
  CodeComponentConfig,
  HttpAuth,
  HttpComponentConfig,
  HttpHeader,
  HttpMethod,
} from "~/optimization_studio/types/dsl";
import type { AgentComponentConfig } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { AgentComponent, Field as DslField } from "../../types/dsl";
import {
  buildAgentNodeData,
  nodeMatchesAgent,
  readCodeSnapshot,
  readHttpSnapshot,
} from "../../utils/agentNodeData";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../utils/edgeMappingUtils";
import { CodeEditorModal } from "../code/CodeEditorModal";
import { useRegisterDrawerFooter } from "../drawers/useInsideDrawer";
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

const DEFAULT_CODE = `class Code:
    def __call__(self, input: str):
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
export function AgentPropertiesPanel({ node }: { node: Node<AgentComponent> }) {
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
  const trpcContext = api.useContext();

  const agentData = agentQuery.data;
  // The node's DSL snapshot is the canonical in-workflow state: it is
  // available synchronously (the record fetch is not) and it is what
  // the engine executes. The record is the library baseline.
  const agentType = agentData?.type ?? node.data.agentType;
  const dbName = agentData?.name ?? "";
  const dbConfig = agentData?.config;

  // Local config from node data (unsaved changes)
  const localConfig = node.data.localConfig;

  // Form for name
  const form = useForm<{ name: string }>({
    defaultValues: { name: localConfig?.name ?? node.data.name ?? dbName },
  });

  // ---- HTTP state ----
  const httpSnapshot = readHttpSnapshot(node.data);
  const httpConfig =
    agentType === "http" && dbConfig ? getHttpConfig(dbConfig) : undefined;
  const localSettings = localConfig?.settings as
    | Record<string, unknown>
    | undefined;

  const [url, setUrl] = useState(
    (localSettings?.url as string) ??
      httpSnapshot?.url ??
      httpConfig?.url ??
      "",
  );
  const [method, setMethod] = useState<HttpMethod>(
    (localSettings?.method as HttpMethod) ??
      httpSnapshot?.method ??
      httpConfig?.method ??
      "POST",
  );
  const [bodyTemplate, setBodyTemplate] = useState(
    (localSettings?.bodyTemplate as string) ??
      httpSnapshot?.bodyTemplate ??
      httpConfig?.bodyTemplate ??
      "",
  );
  const [outputPath, setOutputPath] = useState(
    (localSettings?.outputPath as string) ??
      httpSnapshot?.outputPath ??
      httpConfig?.outputPath ??
      "",
  );
  const [headers, setHeaders] = useState<HttpHeader[]>(
    (localSettings?.headers as HttpHeader[]) ??
      httpSnapshot?.headers ??
      httpConfig?.headers ??
      [],
  );
  const [auth, setAuth] = useState<HttpAuth | undefined>(
    (localSettings?.auth as HttpAuth) ??
      httpSnapshot?.auth ??
      httpConfig?.auth ?? { type: "none" },
  );
  // ---- Code state ----
  const codeSnapshot = readCodeSnapshot(node.data);
  const codeConfig = agentType === "code" && dbConfig ? dbConfig : undefined;
  const [code, setCode] = useState(
    (localSettings?.code as string) ??
      codeSnapshot ??
      (codeConfig ? getCodeFromConfig(codeConfig) : DEFAULT_CODE),
  );
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  const applyAgentToEditorState = useCallback(
    (agent: NonNullable<typeof agentData>) => {
      form.reset({ name: agent.name });
      if (agent.type === "http") {
        const config = getHttpConfig(agent.config);
        setUrl(config.url || "");
        setMethod(config.method ?? "POST");
        setBodyTemplate(config.bodyTemplate ?? "");
        setOutputPath(config.outputPath ?? "");
        setHeaders(config.headers ?? []);
        setAuth(config.auth ?? { type: "none" });
      } else if (agent.type === "code") {
        setCode(getCodeFromConfig(agent.config));
      }
    },
    [form],
  );

  // Outer updates: apply the library record into the editor and the
  // node's DSL snapshot only when the record content actually changed
  // (edited elsewhere) and there are no unsaved local edits. A Save
  // records its own submitted signature, so the post-save state never
  // re-applies; node writes only happen on a real content difference,
  // so this cannot loop with the node-to-editor derivation above.
  const appliedAgentSignature = useRef<string | null>(null);
  const agentSignature = agentData
    ? JSON.stringify({ name: agentData.name, config: agentData.config })
    : null;

  useEffect(() => {
    if (!agentData || !agentSignature) return;
    if (appliedAgentSignature.current === agentSignature) return;
    // Local draft wins until saved or discarded.
    if (localConfig?.settings) return;

    const isFirstArrival = appliedAgentSignature.current === null;
    appliedAgentSignature.current = agentSignature;
    if (isFirstArrival && nodeMatchesAgent(node.data, agentData)) {
      return;
    }

    applyAgentToEditorState(agentData);
    setNode({
      id: node.id,
      data: buildAgentNodeData(agentData) as Partial<AgentComponent>,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSignature, localConfig?.settings]);

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
  const savedName = agentData?.name ?? node.data.name ?? "";
  const debouncedSetLocalConfig = useDebouncedCallback(
    (formValues: { name?: string }) => {
      const nameChanged = formValues.name !== savedName;
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
  const handleMethodChange = useCallback(
    (newMethod: HttpMethod) => setMethod(newMethod),
    [],
  );
  const handleBodyTemplateChange = useCallback(
    (newBody: string) => setBodyTemplate(newBody),
    [],
  );
  const handleOutputPathChange = useCallback(
    (newPath: string) => setOutputPath(newPath),
    [],
  );
  const handleAuthChange = useCallback(
    (newAuth: HttpAuth | undefined) => setAuth(newAuth),
    [],
  );
  const handleHeadersChange = useCallback(
    (newHeaders: HttpHeader[]) => setHeaders(newHeaders),
    [],
  );

  // Track HTTP changes for localConfig persistence. Baseline = the
  // node's DSL snapshot (what is saved in this workflow), falling back
  // to the record while a snapshot-less node loads.
  useEffect(() => {
    if (agentType !== "http") return;
    const baseline =
      readHttpSnapshot(node.data) ??
      (agentData ? getHttpConfig(agentData.config) : undefined);
    if (!baseline) return;
    const changed =
      url !== (baseline.url ?? "") ||
      method !== (baseline.method ?? "POST") ||
      bodyTemplate !== (baseline.bodyTemplate ?? "") ||
      outputPath !== (baseline.outputPath ?? "") ||
      JSON.stringify(headers) !== JSON.stringify(baseline.headers ?? []) ||
      JSON.stringify(auth) !==
        JSON.stringify(baseline.auth ?? { type: "none" });

    if (changed) {
      persistLocalSettings({
        url,
        method,
        bodyTemplate,
        outputPath,
        headers,
        auth,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    method,
    bodyTemplate,
    outputPath,
    headers,
    auth,
    agentType,
    agentData,
    node.data.parameters,
    persistLocalSettings,
  ]);

  // Track Code changes for localConfig persistence
  useEffect(() => {
    if (agentType !== "code") return;
    const baseline =
      readCodeSnapshot(node.data) ??
      (agentData ? getCodeFromConfig(agentData.config) : undefined);
    if (baseline === undefined) return;
    if (code !== baseline) {
      persistLocalSettings({ code });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, agentType, agentData, node.data.parameters, persistLocalSettings]);

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
        const existing = existingInputs.find(
          (i) => i.identifier === v.identifier,
        );
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
    const projectId = project.id;
    const trimmedName = form.getValues().name.trim();

    let config: AgentComponentConfig | undefined;
    if (agentType === "http") {
      config = buildHttpConfig(
        url,
        method,
        bodyTemplate,
        outputPath,
        headers,
        auth,
      );
    } else if (agentType === "code") {
      config = buildCodeConfig(
        code,
        (node.data.inputs ?? []).map((i) => ({
          identifier: i.identifier,
          type: i.type,
        })),
        (node.data.outputs ?? []).map((o) => ({
          identifier: o.identifier,
          type: o.type,
        })),
      );
    }

    updateMutation.mutate(
      {
        id: agentId,
        projectId,
        name: trimmedName,
        ...(config ? { config } : {}),
      },
      {
        onSuccess: () => {
          // Write the submitted values through everywhere at once: the
          // query cache (so the library baseline matches without a
          // refetch), the node's DSL snapshot (so the next run executes
          // the save), and the cleared draft. The editor keeps showing
          // exactly what was submitted, so nothing can revert on screen.
          const updatedAgent = {
            ...agentData,
            name: trimmedName,
            ...(config ? { config } : {}),
          } as typeof agentData;
          appliedAgentSignature.current = JSON.stringify({
            name: updatedAgent.name,
            config: updatedAgent.config,
          });
          trpcContext.agents.getById.setData(
            { id: agentId, projectId },
            updatedAgent,
          );
          setNode({
            id: node.id,
            data: {
              ...buildAgentNodeData(updatedAgent),
              localConfig: undefined,
            } as Partial<AgentComponent>,
          });
        },
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
    node.data.inputs,
    node.data.outputs,
    updateMutation,
    trpcContext,
    setNode,
    node.id,
  ]);

  const handleDiscard = useCallback(() => {
    debouncedSetLocalConfig.cancel();
    persistLocalSettings.cancel();
    if (agentData) {
      // Back to the saved record - including any library update that
      // arrived while the draft was holding it back.
      applyAgentToEditorState(agentData);
      appliedAgentSignature.current = JSON.stringify({
        name: agentData.name,
        config: agentData.config,
      });
      setNode({
        id: node.id,
        data: {
          ...buildAgentNodeData(agentData),
          localConfig: undefined,
        } as Partial<AgentComponent>,
      });
      return;
    }
    // Record still loading: drop the draft, keep the node's snapshot.
    form.reset({ name: node.data.name ?? "" });
    const snapshotCode = readCodeSnapshot(node.data);
    if (snapshotCode !== undefined) setCode(snapshotCode);
    const snapshotHttp = readHttpSnapshot(node.data);
    if (snapshotHttp) {
      setUrl(snapshotHttp.url ?? "");
      setMethod(snapshotHttp.method ?? "POST");
      setBodyTemplate(snapshotHttp.bodyTemplate ?? "");
      setOutputPath(snapshotHttp.outputPath ?? "");
      setHeaders(snapshotHttp.headers ?? []);
      setAuth(snapshotHttp.auth ?? { type: "none" });
    }
    setNode({ id: node.id, data: { localConfig: undefined } });
  }, [
    form,
    agentData,
    applyAgentToEditorState,
    setNode,
    node.id,
    node.data,
    debouncedSetLocalConfig,
    persistLocalSettings,
  ]);

  const hasLocalChanges = !!localConfig;

  // HTTP test via shared hook
  const { handleTest } = useHttpTest({
    url,
    method,
    headers,
    auth,
    outputPath,
  });

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

  // Only block on the record fetch when the node carries no snapshot
  // to render from - with one, the editor shows the node's own state
  // immediately (and never the starter template).
  if (agentQuery.isLoading && !node.data.parameters?.length) {
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
    <BasePropertiesPanel
      node={node}
      hideParameters
      hideInputs
      hideOutputs
      paddingX={0}
    >
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
        <Input {...form.register("name")} size="sm" placeholder="Agent name" />
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
              Define a Python class with a `__call__` method that takes inputs
              and returns outputs.
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
