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
import type { AgentConfig as AgentComponentConfig } from "@langwatch/agent-contract";
import {
  buildCodeConfig,
  DEFAULT_CODE,
  getCodeFromConfig,
} from "@langwatch/agent-contract/code-config";
import type { UiNodeOutput } from "@langwatch/browser-host/declarations";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { type FieldMapping, type Variable, VariablesSection } from "@langwatch/prompt-browser-kit";
import { useRegisterDrawerFooter, renderSourceTypeIcon } from "@langwatch/workflow-browser-kit";
import type {
  HttpAuth,
  HttpComponentConfig,
  HttpHeader,
  HttpMethod,
  AgentComponent,
  Field as DslField,
} from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useDebouncedCallback } from "use-debounce";
import { useShallow } from "zustand/react/shallow";

import { useHttpTest } from "../../../../behavior/agents/http/index.ts";
import { HttpConfigEditor } from "../../../../behavior/lent-agent.tsx";
import { OutputsSection } from "../../../../behavior/lent-prompt.tsx";
import { useOrganizationTeamProject } from "../../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../../behavior/use-workflow-store.ts";
import {
  buildAgentNodeData,
  nodeMatchesAgent,
  readCodeSnapshot,
  readHttpSnapshot,
} from "../../../../model/agent-node-data.ts";
import {
  applyMappingChange,
  buildAvailableSources,
  buildInputMappings,
} from "../../../../model/edge-mapping.ts";
import { CodeBlockEditor } from "../../blocks/code-block-editor.tsx";
import { CodeEditorModal } from "../code/workflow-code-editor.transport.tsx";
import { BasePropertiesPanel } from "./base-properties-panel.tsx";

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

function buildHttpConfig({
  url,
  method,
  bodyTemplate,
  outputPath,
  headers,
  auth,
}: {
  url: string;
  method: HttpMethod;
  bodyTemplate: string;
  outputPath: string;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
}): HttpComponentConfig {
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
// Entry component
// ---------------------------------------------------------------------------

/**
 * Properties panel for agent nodes in the optimization studio.
 * Renders agent configuration inline (HTTP tabs or code editor),
 * matching the pattern used by EvaluatorPropertiesPanel.
 */
const CODE_OUTPUT_TYPES: UiNodeOutput["type"][] = ["str", "float", "bool", "dict", "list", "image"];

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

function agentTypeBadge({ agentType }: { agentType?: string | null }): string {
  if (agentType === "http") return "HTTP";
  if (agentType === "code") return "Code";
  if (agentType === "workflow") return "Workflow";
  return "Agent";
}

function DbAgentPanel({ node, agentRef }: { node: Node<AgentComponent>; agentRef: string }) {
  const { project } = useOrganizationTeamProject();
  const updateNodeInternals = useUpdateNodeInternals();
  const { nodes, edges, setNode, setEdges, getWorkflow, deselectAllNodes } = useWorkflowStore(
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
  const trpcContext = api.useUtils();

  const agentData = agentQuery.data;
  // The node's DSL snapshot is the canonical in-workflow state: it is
  // available synchronously (the record fetch is not) and it is what
  // the engine executes. The record is the library baseline.
  const { agentType, dbName, savedName } = agentIdentity(agentData, node.data);
  const dbConfig = agentData?.config;

  // Local config from node data (unsaved changes)
  const localConfig = node.data.localConfig;

  // Form for name
  const form = useForm<{ name: string }>({
    defaultValues: { name: localConfig?.name ?? node.data.name ?? dbName },
  });

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

  const localSettings = localConfig?.settings as Record<string, unknown> | undefined;
  const draftSources = {
    nodeData: node.data,
    agentType,
    dbConfig,
    localSettings,
    persist: persistLocalSettings,
  };
  const { draft, httpSetters, handlers } = useAgentHttpDraft(draftSources);
  const { url, method, bodyTemplate, outputPath, headers, auth } = draft;
  const {
    handleUrlChange,
    handleMethodChange,
    handleBodyTemplateChange,
    handleOutputPathChange,
    handleAuthChange,
    handleHeadersChange,
  } = handlers;
  const { code, setCode } = useAgentCodeDraft(draftSources);

  const applyAgentToEditorState = useCallback(
    (agent: NonNullable<typeof agentData>) => {
      form.reset({ name: agent.name });
      applyAgentConfigToDraft({ agent, httpSetters, setCode });
    },
    [form, httpSetters, setCode],
  );

  // Outer updates: apply the library record into the editor/DSL only when
  // content actually changed (edited elsewhere) with no unsaved local
  // edits. Node writes need a real content difference, so this cannot
  // loop with the node-to-editor derivation above.
  const appliedAgentSignature = useRef<string | null>(null);
  const agentSignature = agentData ? agentSignatureOf(agentData) : null;

  useEffect(() => {
    if (!agentData || !agentSignature) return;
    const apply = takeAgentRecord({
      applied: appliedAgentSignature,
      signature: agentSignature,
      hasDraft: !!localConfig?.settings,
      matchesNode: () => nodeMatchesAgent(node.data, agentData),
    });
    if (!apply) return;

    applyAgentToEditorState(agentData);
    setNode({
      id: node.id,
      data: buildAgentNodeData(agentData) as Partial<AgentComponent>,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentSignature, localConfig?.settings]);

  // Watch name changes
  const debouncedSetLocalConfig = useDebouncedCallback(
    (formValues: { name?: string }) =>
      persistNameDraft({ name: formValues.name, savedName, localConfig, nodeId: node.id, setNode }),
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

  // Convert inputs/outputs for VariablesSection / OutputsSection
  const inputs: Variable[] = (node.data.inputs ?? []).map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  const outputs: UiNodeOutput[] = (node.data.outputs ?? []).map((output) => ({
    identifier: output.identifier,
    type: output.type as UiNodeOutput["type"],
  }));

  const handleInputsChange = useCallback(
    (newVariables: Variable[]) => {
      const newInputs = inputsFromVariables(newVariables, node.data.inputs ?? []);
      setNode({ id: node.id, data: { inputs: newInputs } });
      updateNodeInternals(node.id);
    },
    [node.id, node.data.inputs, setNode, updateNodeInternals],
  );

  const handleOutputsChange = useCallback(
    (newOutputs: UiNodeOutput[]) => {
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

    const config = agentConfigFor({
      agentType,
      http: { url, method, bodyTemplate, outputPath, headers, auth },
      code,
      inputs: node.data.inputs ?? [],
      outputs: node.data.outputs ?? [],
    });

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
          appliedAgentSignature.current = agentSignatureOf(updatedAgent);
          trpcContext.agents.getById.setData({ id: agentId, projectId }, updatedAgent);
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
      appliedAgentSignature.current = agentSignatureOf(agentData);
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
    resetDraftToSnapshot({ nodeData: node.data, setCode, httpSetters });
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
    httpSetters,
    setCode,
  ]);

  const hasLocalChanges = !!localConfig;

  // HTTP test via shared hook
  const { handleTest } = useHttpTest({
    url,
    method,
    headers,
    auth,
    outputPath,
    bodyTemplate,
  });

  // Register footer
  const footerContent = useMemo(
    () => (
      <AgentFooter
        hasLocalChanges={hasLocalChanges}
        onDiscard={handleDiscard}
        onSave={handleSave}
        isSaving={updateMutation.isPending}
        onApply={handleApply}
      />
    ),
    [hasLocalChanges, handleDiscard, handleApply, handleSave, updateMutation.isPending],
  );
  useRegisterDrawerFooter(footerContent);

  // Only block on the record fetch when the node carries no snapshot
  // to render from - with one, the editor shows the node's own state
  // immediately (and never the starter template).
  const hasNoSnapshot = !node.data.parameters?.length;
  if (agentQuery.isLoading && hasNoSnapshot) {
    return (
      <HStack justify="center" paddingY={8} width="full">
        <Spinner size="md" />
      </HStack>
    );
  }

  const typeBadge = agentTypeBadge({ agentType });

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
      {agentType === "code" && <AgentCodeSection code={code} setCode={setCode} />}

      {agentType === "workflow" && (
        <Box paddingX={4}>
          <Text fontSize="sm" color="fg.muted">
            This agent is backed by a workflow. Edit the workflow in Studio to modify its behavior.
          </Text>
        </Box>
      )}

      {/* Inputs with mappings */}
      <Box width="full" paddingX={4}>
        <VariablesSection
          renderSourceIcon={renderSourceTypeIcon}
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
    </BasePropertiesPanel>
  );
}

type HttpDraft = {
  url: string;
  method: HttpMethod;
  bodyTemplate: string;
  outputPath: string;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
};
type HttpDraftSource = Partial<HttpDraft> | undefined;

/** Unsaved local edits win, then the node's snapshot, then the library record. */
function initialHttpDraft({
  localSettings,
  httpSnapshot,
  httpConfig,
}: {
  localSettings: Record<string, unknown> | undefined;
  httpSnapshot: HttpDraftSource;
  httpConfig: HttpDraftSource;
}): HttpDraft {
  return {
    url: (localSettings?.url as string) ?? httpSnapshot?.url ?? httpConfig?.url ?? "",
    method:
      (localSettings?.method as HttpMethod) ?? httpSnapshot?.method ?? httpConfig?.method ?? "POST",
    bodyTemplate:
      (localSettings?.bodyTemplate as string) ??
      httpSnapshot?.bodyTemplate ??
      httpConfig?.bodyTemplate ??
      "",
    outputPath:
      (localSettings?.outputPath as string) ??
      httpSnapshot?.outputPath ??
      httpConfig?.outputPath ??
      "",
    headers:
      (localSettings?.headers as HttpHeader[]) ??
      httpSnapshot?.headers ??
      httpConfig?.headers ??
      [],
    auth: (localSettings?.auth as HttpAuth) ??
      httpSnapshot?.auth ??
      httpConfig?.auth ?? { type: "none" },
  };
}

function initialCode({
  localSettings,
  codeSnapshot,
  codeConfig,
}: {
  localSettings: Record<string, unknown> | undefined;
  codeSnapshot: string | undefined;
  codeConfig: Parameters<typeof getCodeFromConfig>[0] | undefined;
}): string {
  return (
    (localSettings?.code as string) ??
    codeSnapshot ??
    (codeConfig ? getCodeFromConfig(codeConfig) : DEFAULT_CODE)
  );
}

function applyHttpDraft(
  source: Partial<HttpDraft>,
  setters: {
    setUrl: (url: string) => void;
    setMethod: (method: HttpMethod) => void;
    setBodyTemplate: (bodyTemplate: string) => void;
    setOutputPath: (outputPath: string) => void;
    setHeaders: (headers: HttpHeader[]) => void;
    setAuth: (auth: HttpAuth | undefined) => void;
  },
) {
  setters.setUrl(source.url ?? "");
  setters.setMethod(source.method ?? "POST");
  setters.setBodyTemplate(source.bodyTemplate ?? "");
  setters.setOutputPath(source.outputPath ?? "");
  setters.setHeaders(source.headers ?? []);
  setters.setAuth(source.auth ?? { type: "none" });
}

function httpDraftDiffers(draft: HttpDraft, baseline: Partial<HttpDraft>): boolean {
  return (
    draft.url !== (baseline.url ?? "") ||
    draft.method !== (baseline.method ?? "POST") ||
    draft.bodyTemplate !== (baseline.bodyTemplate ?? "") ||
    draft.outputPath !== (baseline.outputPath ?? "") ||
    JSON.stringify(draft.headers) !== JSON.stringify(baseline.headers ?? []) ||
    JSON.stringify(draft.auth) !== JSON.stringify(baseline.auth ?? { type: "none" })
  );
}

function agentConfigFor({
  agentType,
  http,
  code,
  inputs,
  outputs,
}: {
  agentType: string | undefined;
  http: HttpDraft;
  code: string;
  inputs: DslField[];
  outputs: DslField[];
}): AgentComponentConfig | undefined {
  if (agentType === "http") return buildHttpConfig(http);
  if (agentType !== "code") return undefined;
  return buildCodeConfig({
    code,
    inputs: inputs.map((i) => ({ identifier: i.identifier, type: i.type })),
    outputs: outputs.map((o) => ({ identifier: o.identifier, type: o.type })),
  });
}

type AgentLocalConfig = AgentComponent["localConfig"];
type AgentRecordConfig = Parameters<typeof getHttpConfig>[0] | undefined;

/** A renamed agent keeps its draft settings; a name back at the saved one clears an empty draft. */
function persistNameDraft({
  name,
  savedName,
  localConfig,
  nodeId,
  setNode,
}: {
  name: string | undefined;
  savedName: string;
  localConfig: AgentLocalConfig;
  nodeId: string;
  setNode: (node: { id: string; data: Partial<AgentComponent> }) => void;
}) {
  if (name !== savedName) {
    setNode({
      id: nodeId,
      data: { localConfig: { name: name as string, settings: localConfig?.settings } },
    });
    return;
  }
  if (!localConfig?.settings) setNode({ id: nodeId, data: { localConfig: undefined } });
}

/** Baseline is the node's DSL snapshot, else the record while a snapshot-less node loads. */
function trackHttpDraft({
  nodeData,
  agentConfig,
  draft,
  persist,
}: {
  nodeData: AgentComponent;
  agentConfig: AgentRecordConfig;
  draft: HttpDraft;
  persist: (settings: Record<string, unknown>) => void;
}) {
  const baseline =
    readHttpSnapshot(nodeData) ?? (agentConfig ? getHttpConfig(agentConfig) : undefined);
  if (baseline && httpDraftDiffers(draft, baseline)) persist({ ...draft });
}

function trackCodeDraft({
  nodeData,
  agentConfig,
  code,
  persist,
}: {
  nodeData: AgentComponent;
  agentConfig: AgentRecordConfig;
  code: string;
  persist: (settings: Record<string, unknown>) => void;
}) {
  const baseline =
    readCodeSnapshot(nodeData) ?? (agentConfig ? getCodeFromConfig(agentConfig) : undefined);
  if (baseline !== undefined && code !== baseline) persist({ code });
}

function agentSignatureOf(agent: { name: string; config: unknown }): string {
  return JSON.stringify({ name: agent.name, config: agent.config });
}

/**
 * Whether a library record should overwrite the editor: only a new record, never over a local
 * draft, and not on first arrival when the node already matches it. Marks the record applied.
 */
function takeAgentRecord({
  applied,
  signature,
  hasDraft,
  matchesNode,
}: {
  applied: { current: string | null };
  signature: string;
  hasDraft: boolean;
  matchesNode: () => boolean;
}): boolean {
  if (applied.current === signature || hasDraft) return false;
  const isFirstArrival = applied.current === null;
  applied.current = signature;
  return !(isFirstArrival && matchesNode());
}

function resetDraftToSnapshot({
  nodeData,
  setCode,
  httpSetters,
}: {
  nodeData: AgentComponent;
  setCode: (code: string) => void;
  httpSetters: Parameters<typeof applyHttpDraft>[1];
}) {
  const snapshotCode = readCodeSnapshot(nodeData);
  if (snapshotCode !== undefined) setCode(snapshotCode);
  const snapshotHttp = readHttpSnapshot(nodeData);
  if (snapshotHttp) applyHttpDraft(snapshotHttp, httpSetters);
}

function AgentCodeSection({ code, setCode }: { code: string; setCode: (code: string) => void }) {
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  return (
    <>
      <VStack gap={4} align="stretch" paddingX={4} width="full">
        <Field.Root>
          <Field.Label fontSize="sm">Python Code</Field.Label>
          <Text fontSize="xs" color="fg.muted" marginBottom={1}>
            Define a Python class with a `__call__` method that takes inputs and returns outputs.
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
      {/* Code editor modal (outside drawer to avoid focus conflicts) */}
      <CodeEditorModal
        code={code}
        setCode={(v) => setCode(v)}
        open={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
      />
    </>
  );
}

type AgentDraftSources = {
  nodeData: AgentComponent;
  agentType: string | undefined;
  dbConfig: AgentRecordConfig;
  localSettings: Record<string, unknown> | undefined;
  persist: (settings: Record<string, unknown>) => void;
};

/** The HTTP agent's editable draft, persisted to the node as a local draft when it drifts. */
function useAgentHttpDraft({
  nodeData,
  agentType,
  dbConfig,
  localSettings,
  persist,
}: AgentDraftSources) {
  // ---- HTTP state ----
  const httpSnapshot = readHttpSnapshot(nodeData);
  const httpConfig = agentType === "http" && dbConfig ? getHttpConfig(dbConfig) : undefined;

  const initialHttp = initialHttpDraft({ localSettings, httpSnapshot, httpConfig });
  const [url, setUrl] = useState(initialHttp.url);
  const [method, setMethod] = useState<HttpMethod>(initialHttp.method);
  const [bodyTemplate, setBodyTemplate] = useState(initialHttp.bodyTemplate);
  const [outputPath, setOutputPath] = useState(initialHttp.outputPath);
  const [headers, setHeaders] = useState<HttpHeader[]>(initialHttp.headers);
  const [auth, setAuth] = useState<HttpAuth | undefined>(initialHttp.auth);
  const httpSetters = useMemo(
    () => ({ setUrl, setMethod, setBodyTemplate, setOutputPath, setHeaders, setAuth }),
    [],
  );
  const handleUrlChange = useCallback((newUrl: string) => setUrl(newUrl), []);
  const handleMethodChange = useCallback((newMethod: HttpMethod) => setMethod(newMethod), []);
  const handleBodyTemplateChange = useCallback((newBody: string) => setBodyTemplate(newBody), []);
  const handleOutputPathChange = useCallback((newPath: string) => setOutputPath(newPath), []);
  const handleAuthChange = useCallback((newAuth: HttpAuth | undefined) => setAuth(newAuth), []);
  const handleHeadersChange = useCallback((newHeaders: HttpHeader[]) => setHeaders(newHeaders), []);

  // Track HTTP changes for localConfig persistence. Baseline = the
  // node's DSL snapshot (what is saved in this workflow), falling back
  // to the record while a snapshot-less node loads.
  useEffect(() => {
    if (agentType !== "http") return;
    trackHttpDraft({
      nodeData,
      agentConfig: dbConfig,
      draft: { url, method, bodyTemplate, outputPath, headers, auth },
      persist,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    method,
    bodyTemplate,
    outputPath,
    headers,
    auth,
    agentType,
    dbConfig,
    nodeData.parameters,
    persist,
  ]);

  return {
    draft: { url, method, bodyTemplate, outputPath, headers, auth },
    httpSetters,
    handlers: {
      handleUrlChange,
      handleMethodChange,
      handleBodyTemplateChange,
      handleOutputPathChange,
      handleAuthChange,
      handleHeadersChange,
    },
  };
}

/** The code agent's editable source, persisted to the node as a local draft when it drifts. */
function useAgentCodeDraft({
  nodeData,
  agentType,
  dbConfig,
  localSettings,
  persist,
}: AgentDraftSources) {
  // ---- Code state ----
  const codeSnapshot = readCodeSnapshot(nodeData);
  const codeConfig = agentType === "code" && dbConfig ? dbConfig : undefined;
  const [code, setCode] = useState(initialCode({ localSettings, codeSnapshot, codeConfig }));

  // Track Code changes for localConfig persistence
  useEffect(() => {
    if (agentType !== "code") return;
    trackCodeDraft({
      nodeData,
      agentConfig: dbConfig,
      code,
      persist,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, agentType, dbConfig, nodeData.parameters, persist]);

  return { code, setCode };
}

function inputsFromVariables(variables: Variable[], existingInputs: DslField[]): DslField[] {
  return variables.map((v) => {
    const existing = existingInputs.find((i) => i.identifier === v.identifier);
    return {
      identifier: v.identifier,
      type: v.type as DslField["type"],
      ...(existing?.value != null ? { value: existing.value } : {}),
    };
  });
}

function AgentFooter({
  hasLocalChanges,
  onDiscard,
  onSave,
  isSaving,
  onApply,
}: {
  hasLocalChanges: boolean;
  onDiscard: () => void;
  onSave: () => void;
  isSaving: boolean;
  onApply: () => void;
}) {
  return (
    <HStack width="full">
      {hasLocalChanges && (
        <Button variant="outline" size="sm" onClick={onDiscard} data-testid="agent-discard-button">
          Discard
        </Button>
      )}
      <Spacer />
      <Button
        variant="outline"
        size="sm"
        onClick={onSave}
        loading={isSaving}
        data-testid="agent-save-button"
      >
        Save
      </Button>
      <Button colorPalette="blue" size="sm" onClick={onApply} data-testid="agent-apply-button">
        Apply
      </Button>
    </HStack>
  );
}

/** The record when loaded, else the node's own snapshot of it. */
function agentIdentity(
  agentData: { type?: string; name?: string } | undefined,
  nodeData: AgentComponent,
) {
  return {
    agentType: agentData?.type ?? nodeData.agentType,
    dbName: agentData?.name ?? "",
    savedName: agentData?.name ?? nodeData.name ?? "",
  };
}

function applyAgentConfigToDraft({
  agent,
  httpSetters,
  setCode,
}: {
  agent: { type?: string; config: NonNullable<AgentRecordConfig> };
  httpSetters: Parameters<typeof applyHttpDraft>[1];
  setCode: (code: string) => void;
}) {
  if (agent.type === "http") {
    const config = getHttpConfig(agent.config);
    applyHttpDraft({ ...config, url: config.url || "" }, httpSetters);
  } else if (agent.type === "code") {
    setCode(getCodeFromConfig(agent.config));
  }
}
