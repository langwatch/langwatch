import type { HttpTestErrorExplanation } from "@langwatch/agent-contract/http-test";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Field, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { hasScenarioInputMapping } from "@langwatch/scenario-contract";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  useHttpAgentEditor,
  HTTP_FIXED_VARIABLE_IDS,
  type HttpAgentEditorOptions,
} from "../../behavior/use-http-agent-editor.ts";
import { HttpMethodSelector } from "../elements/http-method-selector.tsx";
import {
  AgentHttpEditorTabs,
  type RenderScenarioMappingsInput,
  type RenderAgentVariablesInput,
} from "./agent-http-editor-tabs.tsx";

export interface AgentHttpEditorDrawerProps extends HttpAgentEditorOptions {
  onGoBack?: () => void;
  renderScenarioMappings: (input: RenderScenarioMappingsInput) => ReactNode;
  renderVariables: (input: RenderAgentVariablesInput) => ReactNode;
  renderTestPanel(input: { agentId: string; projectId: string }): ReactNode;
  explainTestError: HttpTestErrorExplanation;
}

const FOCUS_IDS = { name: "name", url: "url", mapping: "mapping" } as const;

/** What Save needs to submit on click: the problems, where focus goes first, and the attempt. */
function useHttpSubmit({
  form,
  isSaving,
}: {
  form: ReturnType<typeof useHttpAgentEditor>;
  isSaving: boolean | undefined;
}) {
  const [attempts, setAttempts] = useState(0);
  const firstInvalid = useRef<string | null>(null);
  const nameMissing = form.draft.name.trim().length === 0;
  const urlMissing = form.draft.url.trim().length === 0;
  const mappingMissing = !hasScenarioInputMapping(form.draft.scenarioMappings);

  useEffect(() => {
    if (attempts > 0 && firstInvalid.current) {
      document.querySelector<HTMLElement>(`[data-agent-focus="${firstInvalid.current}"]`)?.focus();
    }
  }, [attempts]);

  // Save stays clickable; an attempt with a problem shows it and moves focus to the first one.
  const trySave = () => {
    if (isSaving) return;
    const target = firstProblem({ nameMissing, urlMissing, mappingMissing });
    if (target) {
      firstInvalid.current = FOCUS_IDS[target];
      setAttempts((count) => count + 1);
      return;
    }
    void form.save();
  };

  return {
    attempted: attempts > 0,
    nameMissing,
    urlMissing,
    mappingMissing,
    trySave,
  };
}

function firstProblem(input: {
  nameMissing: boolean;
  urlMissing: boolean;
  mappingMissing: boolean;
}) {
  if (input.nameMissing) return "name";
  if (input.urlMissing) return "url";
  if (input.mappingMissing) return "mapping";
  return void 0;
}

export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const form = useHttpAgentEditor(props);
  const submit = useHttpSubmit({ form, isSaving: props.isSaving });
  const { attempted, nameMissing, urlMissing, mappingMissing } = submit;
  const unavailable = form.isUnavailable && !props.isLoadingAgent;

  return (
    <Drawer
      open={props.open !== false && props.open !== undefined}
      onClose={form.close}
      onBack={props.onGoBack}
      backButtonTestId="back-button"
      size="lg"
      title={props.agentId ? "Edit HTTP Agent" : "New HTTP Agent"}
      body="flush"
      bodyScroll="content"
      loading={Boolean(props.agentId && props.isLoadingAgent)}
      footer={{
        cancel: { onClick: form.close },
        primaryAction: {
          label: props.agentId ? "Save Changes" : "Create Agent",
          onClick: submit.trySave,
          loading: props.isSaving,
          disabledReason: unavailable ? "This HTTP agent could not be loaded." : void 0,
          "data-testid": "save-agent-button",
        },
      }}
    >
      <VStack gap={4} align="stretch" flex={1} overflow="hidden">
        {unavailable && (
          <Box role="alert" paddingX={6} paddingTop={4} color="fg.error">
            This HTTP agent could not be loaded. Close the editor and try again.
          </Box>
        )}
        <Box paddingX={6} paddingTop={unavailable ? 0 : 4}>
          <Field.Root required invalid={attempted && nameMissing}>
            <Field.Label>Agent Name</Field.Label>
            <Input
              data-agent-focus={FOCUS_IDS.name}
              value={form.draft.name}
              onChange={(event) => form.change({ name: event.target.value })}
              placeholder="Enter agent name"
              data-testid="agent-name-input"
            />
            <Field.ErrorText>Enter an agent name.</Field.ErrorText>
          </Field.Root>
        </Box>

        <Box paddingX={6}>
          <HStack gap={2}>
            <HttpMethodSelector
              value={form.draft.method}
              onChange={(value) => form.change({ method: value })}
            />
            <Input
              data-agent-focus={FOCUS_IDS.url}
              value={form.draft.url}
              onChange={(event) => form.change({ url: event.target.value })}
              placeholder="https://api.example.com/agent/chat"
              flex={1}
              aria-invalid={attempted && urlMissing ? true : void 0}
              aria-describedby={attempted && urlMissing ? "http-agent-url-error" : void 0}
              data-testid="url-input"
            />
          </HStack>
          {attempted && urlMissing && (
            <Text
              id="http-agent-url-error"
              role="alert"
              fontSize="xs"
              color="fg.error"
              marginTop={1.5}
            >
              Enter an endpoint URL.
            </Text>
          )}
        </Box>

        {attempted && mappingMissing && (
          <Box data-agent-focus={FOCUS_IDS.mapping} tabIndex={-1} outline="none" paddingX={6}>
            <Text role="alert" fontSize="sm" color="fg.error">
              Map the scenario input or messages to one of this agent&apos;s variables.
            </Text>
          </Box>
        )}

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
          stored={form.stored}
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
          hooks={{
            hooksUrl: form.draft.hooksUrl,
            onHooksUrlChange: form.hooks.changeHooksUrl,
            hooks: form.draft.hooks,
            onHooksChange: (value) => form.change({ hooks: value }),
            newSigningSecret: form.hooks.newSigningSecret,
            hasStoredSigningSecret: form.hooks.hasStoredSigningSecret,
            onRotateSigningSecret: form.hooks.rotateSigningSecret,
          }}
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
    </Drawer>
  );
}
