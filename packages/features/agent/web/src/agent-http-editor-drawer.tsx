import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  httpAgentConfigSchema,
  type AgentInputBinding,
  type AgentWithFields,
  type Field as Variable,
  type HttpAgentConfig,
  type HttpAuth,
  type HttpHeader,
  type HttpMethod,
} from "@langwatch/agent-contract";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentHttpEditorTabs } from "./agent-http-editor-tabs";
import type { AgentHttpEditorPresentation } from "./agent-http-editor.presentation";
import { HttpMethodSelector } from "./http-method-selector";
import type { HttpTestResult } from "./http-test.types";

const DEFAULT_URL = "https://api.example.com/agent/chat";
const DEFAULT_METHOD: HttpMethod = "POST";
const DEFAULT_BODY_TEMPLATE = `{
  "thread_id": "{{threadId}}",
  "messages": {{messages}}
}`;
const DEFAULT_OUTPUT_PATH = "$.choices[0].message.content";

const FIXED_VARIABLES: Variable[] = [
  { identifier: "threadId", type: "str" },
  { identifier: "input", type: "str" },
  { identifier: "messages", type: "chat_messages" },
];

const FIXED_VARIABLE_IDS = new Set(
  FIXED_VARIABLES.map((variable) => variable.identifier),
);
const EMPTY_INPUT_MAPPINGS: Record<string, AgentInputBinding> = {};
const EMPTY_SCENARIO_MAPPINGS: Record<string, AgentInputBinding> = {};

type SaveHttpAgentInput = {
  projectId: string;
  name: string;
  config: HttpAgentConfig;
};

export type AgentHttpEditorDrawerProps = {
  open?: boolean;
  agentId?: string;
  agent?: AgentWithFields | null;
  isLoadingAgent?: boolean;
  isSaving?: boolean;
  projectId?: string;
  onClose: () => void;
  onGoBack?: () => void;
  onSave?: (agent: AgentWithFields) => void;
  onCreate: (input: SaveHttpAgentInput) => Promise<AgentWithFields>;
  onUpdate: (input: SaveHttpAgentInput & { id: string }) => Promise<AgentWithFields>;
  onTest: (input: {
    url: string;
    method: HttpMethod;
    headers: HttpHeader[];
    auth: HttpAuth | undefined;
    outputPath: string;
    bodyTemplate: string;
    templateVariables: Record<string, unknown>;
  }) => Promise<HttpTestResult>;
  presentation: AgentHttpEditorPresentation;
  defaultScenarioMappings?: Record<string, AgentInputBinding>;
  availableSources?: unknown[];
  inputMappings?: Record<string, AgentInputBinding>;
  onInputMappingsChange?: (
    identifier: string,
    mapping: AgentInputBinding | undefined,
  ) => void;
};

function getHttpConfig(
  agent: AgentWithFields | null | undefined,
): HttpAgentConfig | null {
  if (agent?.type !== "http") {
    return null;
  }

  const parsed = httpAgentConfigSchema.safeParse(agent.config);
  return parsed.success ? parsed.data : null;
}

function buildHttpConfig(input: {
  url: string;
  method: HttpMethod;
  bodyTemplate: string;
  outputPath: string;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
  scenarioMappings: Record<string, AgentInputBinding>;
}): HttpAgentConfig {
  return {
    name: "HTTP",
    description: "HTTP API endpoint",
    url: input.url,
    method: input.method,
    bodyTemplate: input.bodyTemplate,
    outputPath: input.outputPath,
    headers: input.headers.length > 0 ? input.headers : void 0,
    auth: input.auth?.type === "none" ? void 0 : input.auth,
    scenarioMappings:
      Object.keys(input.scenarioMappings).length > 0 ? input.scenarioMappings : void 0,
  };
}

function hasScenarioInputMapping(mappings: Record<string, AgentInputBinding>): boolean {
  return Object.values(mappings).some(
    (mapping) =>
      mapping.type === "source" &&
      (mapping.path[0] === "input" || mapping.path[0] === "messages"),
  );
}

export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const isOpen = props.open === true;
  const defaultScenarioMappings =
    props.defaultScenarioMappings ?? EMPTY_SCENARIO_MAPPINGS;
  const initialInputMappings = props.inputMappings ?? EMPTY_INPUT_MAPPINGS;
  const showVariablesTab = (props.availableSources?.length ?? 0) > 0;
  const [localMappings, setLocalMappings] = useState(initialInputMappings);
  const [name, setName] = useState("");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [method, setMethod] = useState<HttpMethod>(DEFAULT_METHOD);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY_TEMPLATE);
  const [outputPath, setOutputPath] = useState(DEFAULT_OUTPUT_PATH);
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  const [auth, setAuth] = useState<HttpAuth | undefined>({ type: "none" });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [customVariables, setCustomVariables] = useState<Variable[]>([]);
  const [scenarioMappings, setScenarioMappings] = useState<
    Record<string, AgentInputBinding>
  >({});
  const [activeTab, setActiveTab] = useState(showVariablesTab ? "variables" : "body");
  const formInitializedRef = useRef(false);
  const lastAgentIdRef = useRef<string | undefined>(void 0);

  const variables = useMemo(
    () => [...FIXED_VARIABLES, ...customVariables],
    [customVariables],
  );
  const hasAtLeastOneMapping = useMemo(
    () => variables.some((variable) => localMappings[variable.identifier]),
    [localMappings, variables],
  );
  const missingMappingIds = useMemo(() => {
    if (!showVariablesTab || hasAtLeastOneMapping) {
      return new Set<string>();
    }

    return new Set(variables.map((variable) => variable.identifier));
  }, [hasAtLeastOneMapping, showVariablesTab, variables]);
  const config = getHttpConfig(props.agent);

  useEffect(() => {
    setLocalMappings(initialInputMappings);
  }, [initialInputMappings]);

  useEffect(() => {
    if (lastAgentIdRef.current !== props.agentId) {
      formInitializedRef.current = false;
      lastAgentIdRef.current = props.agentId;
    }

    if (formInitializedRef.current) {
      return;
    }

    if (config) {
      const persistedScenarioMappings = config.scenarioMappings ?? {};
      const initialScenarioMappings =
        Object.keys(persistedScenarioMappings).length > 0
          ? persistedScenarioMappings
          : defaultScenarioMappings;

      setName(props.agent?.name ?? "");
      setUrl(config.url || DEFAULT_URL);
      setMethod(config.method ?? DEFAULT_METHOD);
      setBodyTemplate(config.bodyTemplate || DEFAULT_BODY_TEMPLATE);
      setOutputPath(config.outputPath || DEFAULT_OUTPUT_PATH);
      setHeaders(config.headers ?? []);
      setAuth(config.auth ?? { type: "none" });
      setScenarioMappings(initialScenarioMappings);
      setHasUnsavedChanges(false);
      formInitializedRef.current = true;
      return;
    }

    if (!props.agentId && isOpen) {
      setName("");
      setUrl(DEFAULT_URL);
      setMethod(DEFAULT_METHOD);
      setBodyTemplate(DEFAULT_BODY_TEMPLATE);
      setOutputPath(DEFAULT_OUTPUT_PATH);
      setHeaders([]);
      setAuth({ type: "none" });
      setScenarioMappings(defaultScenarioMappings);
      setHasUnsavedChanges(false);
      formInitializedRef.current = true;
    }
  }, [config, defaultScenarioMappings, isOpen, props.agent?.name, props.agentId]);

  useEffect(() => {
    if (!isOpen) {
      formInitializedRef.current = false;
    }
  }, [isOpen]);

  const handleMappingChange = useCallback(
    (identifier: string, mapping: AgentInputBinding | undefined) => {
      setLocalMappings((previous) => {
        if (mapping) {
          return { ...previous, [identifier]: mapping };
        }

        const next = { ...previous };
        delete next[identifier];
        return next;
      });
      props.onInputMappingsChange?.(identifier, mapping);
    },
    [props.onInputMappingsChange],
  );

  const handleVariablesChange = useCallback((newVariables: Variable[]) => {
    const newCustomVariables = newVariables.filter(
      (variable) => !FIXED_VARIABLE_IDS.has(variable.identifier),
    );
    setCustomVariables(newCustomVariables);
    setHasUnsavedChanges(true);
  }, []);

  const handleScenarioMappingChange = useCallback(
    (identifier: string, mapping: AgentInputBinding | undefined) => {
      setScenarioMappings((previous) => {
        if (mapping) {
          return { ...previous, [identifier]: mapping };
        }

        const next = { ...previous };
        delete next[identifier];
        return next;
      });
      setHasUnsavedChanges(true);
    },
    [],
  );

  const isValid =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    hasScenarioInputMapping(scenarioMappings);

  const handleSave = useCallback(async () => {
    if (!props.projectId || !isValid) {
      return;
    }

    const config = buildHttpConfig({
      url,
      method,
      bodyTemplate,
      outputPath,
      headers,
      auth,
      scenarioMappings,
    });
    const input = {
      projectId: props.projectId,
      name: name.trim(),
      config,
    };

    try {
      const agent = props.agentId
        ? await props.onUpdate({ ...input, id: props.agentId })
        : await props.onCreate(input);
      props.onSave?.(agent);
      props.onClose();
    } catch (error) {
      props.presentation.showSaveError({
        error,
        fallbackTitle: props.agentId ? "Couldn't save agent" : "Couldn't create agent",
      });
    }
  }, [
    auth,
    bodyTemplate,
    headers,
    isValid,
    method,
    name,
    outputPath,
    props,
    scenarioMappings,
    url,
  ]);

  const handleClose = () => {
    if (
      hasUnsavedChanges &&
      !window.confirm("You have unsaved changes. Are you sure you want to close?")
    ) {
      return;
    }

    props.onClose();
  };

  const handleTest = useCallback(
    (templateVariables: Record<string, unknown>) =>
      props.onTest({
        url,
        method,
        headers,
        auth,
        outputPath,
        bodyTemplate,
        templateVariables,
      }),
    [auth, bodyTemplate, headers, method, outputPath, props, url],
  );

  const markDirty = () => setHasUnsavedChanges(true);

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {props.onGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onGoBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading>{props.agentId ? "Edit HTTP Agent" : "New HTTP Agent"}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {props.agentId && props.isLoadingAgent ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack gap={4} align="stretch" flex={1} overflow="hidden">
              <Box paddingX={6} paddingTop={4}>
                <Field.Root required>
                  <Field.Label>Agent Name</Field.Label>
                  <Input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      markDirty();
                    }}
                    placeholder="Enter agent name"
                    data-testid="agent-name-input"
                  />
                </Field.Root>
              </Box>

              <Box paddingX={6}>
                <HStack gap={2}>
                  <HttpMethodSelector
                    value={method}
                    onChange={(value) => {
                      setMethod(value);
                      markDirty();
                    }}
                  />
                  <Input
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      markDirty();
                    }}
                    placeholder="https://api.example.com/agent/chat"
                    flex={1}
                    data-testid="url-input"
                  />
                </HStack>
              </Box>

              <AgentHttpEditorTabs
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                showVariablesTab={showVariablesTab}
                bodyTemplate={bodyTemplate}
                onBodyTemplateChange={(value) => {
                  setBodyTemplate(value);
                  markDirty();
                }}
                outputPath={outputPath}
                onOutputPathChange={(value) => {
                  setOutputPath(value);
                  markDirty();
                }}
                variables={variables}
                scenarioMappings={scenarioMappings}
                onScenarioMappingChange={handleScenarioMappingChange}
                auth={auth}
                onAuthChange={(value) => {
                  setAuth(value);
                  markDirty();
                }}
                headers={headers}
                onHeadersChange={(value) => {
                  setHeaders(value);
                  markDirty();
                }}
                method={method}
                url={url}
                localMappings={localMappings}
                onVariablesChange={handleVariablesChange}
                onMappingChange={handleMappingChange}
                missingMappingIds={missingMappingIds}
                fixedVariableIds={FIXED_VARIABLE_IDS}
                hasAtLeastOneMapping={hasAtLeastOneMapping}
                onTest={handleTest}
                presentation={props.presentation}
              />
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || props.isSaving}
              loading={props.isSaving}
              data-testid="save-agent-button"
            >
              {props.agentId ? "Save Changes" : "Create Agent"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
