import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
  Tabs,
} from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { useState, useCallback, useEffect } from "react";

import { Drawer } from "~/components/ui/drawer";
import {
  useDrawer,
  getComplexProps,
  useDrawerParams,
  getFlowCallbacks,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { AvailableSource, FieldMapping } from "~/components/variables";
import type {
  TypedAgent,
  AgentComponentConfig,
} from "~/server/agents/agent.repository";
import type {
  HttpComponentConfig,
  HttpMethod,
  HttpAuth,
  HttpHeader,
} from "~/optimization_studio/types/dsl";

import {
  HttpMethodSelector,
  BodyTemplateEditor,
  OutputPathInput,
  AuthConfigSection,
  HeadersConfigSection,
  HttpTestPanel,
} from "./http";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_URL = "https://api.example.com/agent/chat";
const DEFAULT_METHOD: HttpMethod = "POST";
const DEFAULT_BODY_TEMPLATE = `{
  "thread_id": "{{threadId}}",
  "messages": {{messages}}
}`;
const DEFAULT_OUTPUT_PATH = "$.choices[0].message.content";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract HTTP config from AgentComponentConfig
 */
function getHttpConfig(config: AgentComponentConfig): HttpComponentConfig {
  return config as HttpComponentConfig;
}

/**
 * Build DSL-compatible config for HTTP agent
 */
function buildHttpConfig(
  url: string,
  method: HttpMethod,
  bodyTemplate: string,
  outputPath: string,
  headers: HttpHeader[],
  auth: HttpAuth | undefined
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

// ============================================================================
// Props
// ============================================================================

export type AgentHttpEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** If provided, loads an existing agent for editing */
  agentId?: string;
  /** Available sources for variable mapping (from Evaluations V3) */
  availableSources?: AvailableSource[];
  /** Current input mappings (from Evaluations V3) */
  inputMappings?: Record<string, FieldMapping>;
  /** Callback when input mappings change (for Evaluations V3) */
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined
  ) => void;
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * Drawer for creating/editing an HTTP-based agent.
 * Features a tabbed interface for I/O, Body, Auth, Headers, and Test.
 */
export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const flowCallbacks = getFlowCallbacks("agentHttpEditor");
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as AgentHttpEditorDrawerProps["onSave"]);
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Props from drawer params or direct props (for Evaluations V3)
  const availableSources =
    props.availableSources ??
    (complexProps.availableSources as AvailableSource[] | undefined);

  // Form state
  const [name, setName] = useState("");
  const [url, setUrl] = useState(DEFAULT_URL);
  const [method, setMethod] = useState<HttpMethod>(DEFAULT_METHOD);
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_BODY_TEMPLATE);
  const [outputPath, setOutputPath] = useState(DEFAULT_OUTPUT_PATH);
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  const [auth, setAuth] = useState<HttpAuth | undefined>({ type: "none" });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [activeTab, setActiveTab] = useState("body");

  // Load existing agent if editing
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && isOpen }
  );

  // Initialize form with agent data
  useEffect(() => {
    if (agentQuery.data) {
      const config = getHttpConfig(agentQuery.data.config);
      setName(agentQuery.data.name ?? "");
      setUrl(config.url || DEFAULT_URL);
      setMethod(config.method ?? DEFAULT_METHOD);
      // Use || to also catch empty strings
      setBodyTemplate(config.bodyTemplate || DEFAULT_BODY_TEMPLATE);
      setOutputPath(config.outputPath || DEFAULT_OUTPUT_PATH);
      setHeaders(config.headers ?? []);
      setAuth(config.auth ?? { type: "none" });
      setHasUnsavedChanges(false);
    } else if (!agentId) {
      // Reset form for new agent
      setName("");
      setUrl(DEFAULT_URL);
      setMethod(DEFAULT_METHOD);
      setBodyTemplate(DEFAULT_BODY_TEMPLATE);
      setOutputPath(DEFAULT_OUTPUT_PATH);
      setHeaders([]);
      setAuth({ type: "none" });
      setHasUnsavedChanges(false);
    }
  }, [agentQuery.data, agentId, isOpen]);

  // Mutations
  const createMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.(agent);
      onClose();
    },
  });

  const updateMutation = api.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.agents.getById.invalidate({
        id: agent.id,
        projectId: project?.id ?? "",
      });
      onSave?.(agent);
      onClose();
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = (name?.trim().length ?? 0) > 0 && (url?.trim().length ?? 0) > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;

    const config = buildHttpConfig(
      url,
      method,
      bodyTemplate,
      outputPath,
      headers,
      auth
    );

    if (agentId) {
      updateMutation.mutate({
        id: agentId,
        projectId: project.id,
        name: name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId: project.id,
        name: name.trim(),
        type: "http",
        config,
      });
    }
  }, [
    project?.id,
    agentId,
    name,
    url,
    method,
    bodyTemplate,
    outputPath,
    headers,
    auth,
    isValid,
    createMutation,
    updateMutation,
  ]);

  const markDirty = () => setHasUnsavedChanges(true);

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?"
        )
      ) {
        return;
      }
    }
    onClose();
  };

  // HTTP proxy mutation for testing
  const httpProxyMutation = api.httpProxy.execute.useMutation();

  // Test handler - calls the backend API
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
    [project?.id, url, method, headers, auth, outputPath, httpProxyMutation]
  );

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
      preventScroll={false}
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                padding={1}
                minWidth="auto"
                data-testid="back-button"
              >
                <LuArrowLeft size={20} />
              </Button>
            )}
            <Heading>{agentId ? "Edit HTTP Agent" : "New HTTP Agent"}</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {agentId && agentQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack gap={4} align="stretch" flex={1} overflow="hidden">
              {/* Agent Name */}
              <Box paddingX={6} paddingTop={4}>
                <Field.Root required>
                  <Field.Label>Agent Name</Field.Label>
                  <Input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      markDirty();
                    }}
                    placeholder="Enter agent name"
                    data-testid="agent-name-input"
                  />
                </Field.Root>
              </Box>

              {/* URL with Method Selector */}
              <Box paddingX={6}>
                <HStack gap={2}>
                  <HttpMethodSelector
                    value={method}
                    onChange={(m) => {
                      setMethod(m);
                      markDirty();
                    }}
                  />
                  <Input
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      markDirty();
                    }}
                    placeholder="https://api.example.com/agent/chat"
                    flex={1}
                    data-testid="url-input"
                  />
                </HStack>
              </Box>

              {/* Tabbed Content */}
              <Tabs.Root
                value={activeTab}
                onValueChange={(e) => setActiveTab(e.value)}
                flex={1}
                display="flex"
                flexDirection="column"
                overflow="hidden"
                colorPalette="blue"
              >
                <Tabs.List paddingX={6} borderBottomWidth="1px" borderColor="gray.200">
                  <Tabs.Trigger value="body">Body</Tabs.Trigger>
                  <Tabs.Trigger value="auth">Auth</Tabs.Trigger>
                  <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
                  <Tabs.Trigger value="test">Test</Tabs.Trigger>
                </Tabs.List>

                {/* Body Tab */}
                <Tabs.Content
                  value="body"
                  flex={1}
                  overflowY="auto"
                  paddingX={6}
                  paddingY={4}
                >
                  <VStack gap={6} align="stretch">
                    <Field.Root>
                      <Field.Label>Request Body Template</Field.Label>
                      <Text fontSize="sm" color="gray.500" marginBottom={2}>
                        JSON body with mustache variables. Variables are replaced at runtime.
                      </Text>
                      <BodyTemplateEditor
                        value={bodyTemplate}
                        onChange={(v) => {
                          setBodyTemplate(v);
                          markDirty();
                        }}
                      />
                    </Field.Root>
                    <Field.Root>
                      <Field.Label>Output Path (JSONPath)</Field.Label>
                      <OutputPathInput
                        value={outputPath}
                        onChange={(v) => {
                          setOutputPath(v);
                          markDirty();
                        }}
                      />
                    </Field.Root>
                  </VStack>
                </Tabs.Content>

                {/* Auth Tab */}
                <Tabs.Content
                  value="auth"
                  flex={1}
                  overflowY="auto"
                  paddingX={6}
                  paddingY={4}
                >
                  <AuthConfigSection
                    value={auth}
                    onChange={(a) => {
                      setAuth(a);
                      markDirty();
                    }}
                  />
                </Tabs.Content>

                {/* Headers Tab */}
                <Tabs.Content
                  value="headers"
                  flex={1}
                  overflowY="auto"
                  paddingX={6}
                  paddingY={4}
                >
                  <HeadersConfigSection
                    value={headers}
                    onChange={(h) => {
                      setHeaders(h);
                      markDirty();
                    }}
                  />
                </Tabs.Content>

                {/* Test Tab */}
                <Tabs.Content
                  value="test"
                  flex={1}
                  overflowY="auto"
                  paddingX={6}
                  paddingY={4}
                >
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
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-agent-button"
            >
              {agentId ? "Save Changes" : "Create Agent"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
