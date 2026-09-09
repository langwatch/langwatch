import { Box, Button, Field, Heading, HStack, Input, Spinner, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import {
  AgentHttpEditorTabs,
  type RenderScenarioMappingsInput,
  type RenderAgentVariablesInput,
} from "./agent-http-editor-tabs.tsx";
import { HttpMethodSelector } from "../elements/http-method-selector.tsx";
import {
  useHttpAgentEditor,
  HTTP_FIXED_VARIABLE_IDS,
  type HttpAgentEditorOptions,
} from "../../behavior/use-http-agent-editor.ts";
import type { HttpTestErrorExplanationPort } from "../../model/http-test.types.ts";

export interface AgentHttpEditorDrawerProps extends HttpAgentEditorOptions {
  onGoBack?: () => void;
  renderScenarioMappings(input: RenderScenarioMappingsInput): ReactNode;
  renderVariables(input: RenderAgentVariablesInput): ReactNode;
  renderTestPanel(input: { agentId: string; projectId: string }): ReactNode;
  explainTestError: HttpTestErrorExplanationPort;
}

export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const form = useHttpAgentEditor(props);

  return (
    <Drawer.Root
      open={props.open === true}
      onOpenChange={({ open }) => !open && form.close()}
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
        {form.isUnavailable && !props.isLoadingAgent && (
          <Box role="alert" paddingX={6} paddingBottom={4} color="fg.error">
            This HTTP agent could not be loaded. Close the editor and try again.
          </Box>
        )}
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
                    value={form.draft.name}
                    onChange={(event) => form.change({ name: event.target.value })}
                    placeholder="Enter agent name"
                    data-testid="agent-name-input"
                  />
                </Field.Root>
              </Box>

              <Box paddingX={6}>
                <HStack gap={2}>
                  <HttpMethodSelector
                    value={form.draft.method}
                    onChange={(value) => form.change({ method: value })}
                  />
                  <Input
                    value={form.draft.url}
                    onChange={(event) => form.change({ url: event.target.value })}
                    placeholder="https://api.example.com/agent/chat"
                    flex={1}
                    data-testid="url-input"
                  />
                </HStack>
              </Box>

              <AgentHttpEditorTabs
                activeTab={form.activeTab}
                onActiveTabChange={form.setActiveTab}
                showVariablesTab={props.showVariables === true}
                bodyTemplate={form.draft.bodyTemplate}
                onBodyTemplateChange={(value) => form.change({ bodyTemplate: value })}
                outputPath={form.draft.outputPath}
                onOutputPathChange={(value) => form.change({ outputPath: value })}
                sessionPath={form.draft.sessionPath}
                onSessionPathChange={(value) => form.change({ sessionPath: value })}
                variables={form.variables}
                scenarioMappings={form.draft.scenarioMappings}
                onScenarioMappingChange={form.changeScenarioMapping}
                auth={form.draft.auth}
                onAuthChange={(value) => form.change({ auth: value })}
                headers={form.draft.headers}
                onHeadersChange={(value) => form.change({ headers: value })}
                method={form.draft.method}
                url={form.draft.url}
                localMappings={form.localMappings}
                onVariablesChange={form.changeVariables}
                onMappingChange={form.changeMapping}
                missingMappingIds={form.missingMappingIds}
                fixedVariableIds={HTTP_FIXED_VARIABLE_IDS}
                hasAtLeastOneMapping={form.hasAtLeastOneMapping}
                onTest={form.test}
                renderScenarioMappings={props.renderScenarioMappings}
                renderVariables={props.renderVariables}
                explainTestError={props.explainTestError}
              />
              {props.agentId && props.projectId ? (
                <Box paddingX={6} paddingY={4} borderTopWidth="1px" borderColor="border">
                  {props.renderTestPanel({
                    agentId: props.agentId,
                    projectId: props.projectId,
                  })}
                </Box>
              ) : null}
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={form.close}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={form.save}
              disabled={!form.isValid || props.isSaving}
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
