import {
  AgentHttpEditorDrawer as AgentHttpEditor,
  type AgentHttpEditorPresentation,
} from "@langwatch/agent-web";
import {
  agentInputBindingSchema,
  FIELD_TYPES,
  type AgentWithFields,
  type HttpAgentConfig,
  type HttpAuth,
  type HttpHeader,
  type HttpMethod,
} from "@langwatch/agent-contract";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { ScenarioInputMappingSection } from "~/components/suites/ScenarioInputMappingSection";
import {
  type AvailableSource,
  type FieldMapping,
  VariablesSection,
} from "~/components/variables";
import { showErrorToast } from "~/features/errors";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { explainExecutionStateError } from "~/optimization_studio/utils/executionStateError";
import { api } from "~/utils/api";

const inputMappingsSchema = z.record(z.string(), agentInputBindingSchema);
const availableSourceTypeSchema = z.enum([
  "entry",
  "end",
  "signature",
  "code",
  "retriever",
  "prompting_technique",
  "custom",
  "evaluator",
  "http",
  "agent",
  "if_else",
  "dataset",
]);
type AvailableNestedField = AvailableSource["fields"][number];
const nestedFieldLoaderSchema = z.custom<() => AvailableNestedField[]>(
  (value) => typeof value === "function",
);
const nestedFieldSchema: z.ZodType<AvailableNestedField> = z.lazy(() =>
  z.object({
    name: z.string(),
    label: z.string().optional(),
    type: z.enum(FIELD_TYPES),
    children: z.array(nestedFieldSchema).optional(),
    getChildren: nestedFieldLoaderSchema.optional(),
    isComplete: z.boolean().optional(),
    isCompleteLabel: z.string().optional(),
  }),
);
const availableSourcesSchema: z.ZodType<AvailableSource[]> = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    type: availableSourceTypeSchema,
    fields: z.array(nestedFieldSchema),
  }),
);
const saveCallbackSchema = z.custom<(agent: AgentWithFields) => void>(
  (value) => typeof value === "function",
);
const EMPTY_AVAILABLE_SOURCES: AvailableSource[] = [];

export type AgentHttpEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: AgentWithFields) => void;
  agentId?: string;
  availableSources?: AvailableSource[];
  inputMappings?: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
};

function tryParse<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : void 0;
}

export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const flowCallbacks = getFlowCallbacks("agentHttpEditor");
  const utils = api.useUtils();
  const createAgent = api.agents.create.useMutation();
  const updateAgent = api.agents.update.useMutation();
  const executeHttp = api.httpProxy.execute.useMutation();

  const agentId =
    props.agentId ?? drawerParams.agentId ?? tryParse(z.string(), complexProps.agentId);
  const availableSources =
    props.availableSources ??
    tryParse(availableSourcesSchema, complexProps.availableSources) ??
    EMPTY_AVAILABLE_SOURCES;
  const inputMappings =
    props.inputMappings ?? tryParse(inputMappingsSchema, complexProps.inputMappings);
  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    flowCallbacks?.onSave ??
    tryParse(saveCallbackSchema, complexProps.onSave);
  const onInputMappingsChange =
    props.onInputMappingsChange ?? flowCallbacks?.onInputMappingsChange;
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: Boolean(agentId && project?.id && props.open !== false) },
  );

  const handleCreate = useCallback(
    async (input: { projectId: string; name: string; config: HttpAgentConfig }) => {
      const agent = await createAgent.mutateAsync({
        projectId: input.projectId,
        name: input.name,
        type: "http",
        config: input.config,
      });

      void utils.agents.getAll.invalidate({ projectId: input.projectId });
      return agent;
    },
    [createAgent, utils.agents.getAll],
  );

  const handleUpdate = useCallback(
    async (input: {
      id: string;
      projectId: string;
      name: string;
      config: HttpAgentConfig;
    }) => {
      const agent = await updateAgent.mutateAsync(input);

      void utils.agents.getAll.invalidate({ projectId: input.projectId });
      void utils.agents.getById.invalidate({
        id: agent.id,
        projectId: input.projectId,
      });
      return agent;
    },
    [updateAgent, utils.agents.getAll, utils.agents.getById],
  );

  const handleTest = useCallback(
    async (input: {
      url: string;
      method: HttpMethod;
      headers: HttpHeader[];
      auth: HttpAuth | undefined;
      outputPath: string;
      bodyTemplate: string;
      templateVariables: Record<string, unknown>;
    }) => {
      if (!project?.id) {
        return { success: false, error: "No project selected" };
      }

      try {
        const result = await executeHttp.mutateAsync({
          projectId: project.id,
          url: input.url,
          method: input.method,
          headers: input.headers.map((header) => ({
            key: header.key,
            value: header.value,
          })),
          auth: input.auth,
          bodyTemplate: input.bodyTemplate,
          templateVariables: input.templateVariables,
          outputPath: input.outputPath,
        });

        return {
          success: result.success,
          response: result.response,
          extractedOutput: result.extractedOutput,
          error: result.error,
          errorCode: result.errorCode,
          status: result.status,
          statusText: result.statusText,
          duration: result.duration,
          responseHeaders: result.responseHeaders,
          renderedBody: result.renderedBody,
          warnings: result.warnings,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Test request failed",
        };
      }
    },
    [executeHttp, project?.id],
  );

  const defaultScenarioMappings = useMemo(() => {
    const mappings = computeBestMatchMappings({
      inputs: [
        { identifier: "threadId" },
        { identifier: "input" },
        { identifier: "messages" },
      ],
    });
    return tryParse(inputMappingsSchema, mappings) ?? {};
  }, []);

  const presentation = useMemo<AgentHttpEditorPresentation>(
    () => ({
      renderScenarioMappings: ({ inputs, mappings, onMappingChange }) => (
        <ScenarioInputMappingSection
          inputs={inputs}
          mappings={mappings}
          onMappingChange={onMappingChange}
        />
      ),
      renderVariables: ({
        variables,
        mappings,
        onChange,
        onMappingChange,
        missingMappingIds,
        lockedVariableIds,
      }) => (
        <VariablesSection
          title="Input Variables"
          variables={variables}
          onChange={onChange}
          showMappings
          availableSources={availableSources}
          mappings={mappings}
          onMappingChange={onMappingChange}
          canAddRemove
          readOnly={false}
          lockedVariables={lockedVariableIds}
          missingMappingIds={missingMappingIds}
          showMissingMappingsError={false}
          optionalHighlighting
        />
      ),
      explainTestError: ({ errorCode, error }) =>
        explainExecutionStateError({
          state: { error_type: errorCode, error },
          fallbackTitle: "The request failed",
        }),
      showSaveError: showErrorToast,
    }),
    [availableSources],
  );

  return (
    <AgentHttpEditor
      open={props.open}
      agentId={agentId}
      agent={agentQuery.data}
      isLoadingAgent={agentQuery.isLoading}
      isSaving={createAgent.isPending || updateAgent.isPending}
      projectId={project?.id}
      onClose={onClose}
      onGoBack={canGoBack ? goBack : void 0}
      onSave={onSave}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onTest={handleTest}
      presentation={presentation}
      defaultScenarioMappings={defaultScenarioMappings}
      availableSources={availableSources}
      inputMappings={inputMappings}
      onInputMappingsChange={onInputMappingsChange}
    />
  );
}
