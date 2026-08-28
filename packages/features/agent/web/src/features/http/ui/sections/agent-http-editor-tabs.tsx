import { Field, Tabs, Text, VStack } from "@chakra-ui/react";
import type {
  AgentInputBinding as FieldMapping,
  Field as Variable,
} from "@langwatch/agent-contract";
import { AuthConfigSection } from "../elements/http-auth-config-section";
import { BodyTemplateEditor } from "../elements/http-body-template-editor";
import { HeadersConfigSection } from "../elements/http-headers-config-section";
import { HttpTestPanel } from "./http-test-panel";
import { OutputPathInput } from "../elements/http-output-path-input";
import type { HttpAuth, HttpHeader, HttpMethod } from "@langwatch/agent-contract";
import type { AgentHttpEditorPresentationPort } from "./agent-http-editor.presentation";
import type { HttpTestResult } from "../../model/http-test.types";

export type AgentHttpEditorTabsProps = {
  activeTab: string;
  onActiveTabChange: (tab: string) => void;
  showVariablesTab: boolean;
  bodyTemplate: string;
  onBodyTemplateChange: (value: string) => void;
  outputPath: string;
  onOutputPathChange: (value: string) => void;
  variables: Variable[];
  scenarioMappings: Record<string, FieldMapping>;
  onScenarioMappingChange: (identifier: string, mapping: FieldMapping | undefined) => void;
  auth: HttpAuth | undefined;
  onAuthChange: (auth: HttpAuth | undefined) => void;
  headers: HttpHeader[];
  onHeadersChange: (headers: HttpHeader[]) => void;
  method: HttpMethod;
  url: string;
  localMappings: Record<string, FieldMapping>;
  onVariablesChange: (variables: Variable[]) => void;
  onMappingChange: (identifier: string, mapping: FieldMapping | undefined) => void;
  missingMappingIds: Set<string>;
  fixedVariableIds: Set<string>;
  hasAtLeastOneMapping: boolean;
  onTest: (variables: Record<string, unknown>) => Promise<HttpTestResult>;
  presentation: AgentHttpEditorPresentationPort;
};

export function AgentHttpEditorTabs({
  activeTab,
  onActiveTabChange,
  showVariablesTab,
  bodyTemplate,
  onBodyTemplateChange,
  outputPath,
  onOutputPathChange,
  variables,
  scenarioMappings,
  onScenarioMappingChange,
  auth,
  onAuthChange,
  headers,
  onHeadersChange,
  method,
  url,
  localMappings,
  onVariablesChange,
  onMappingChange,
  missingMappingIds,
  fixedVariableIds,
  hasAtLeastOneMapping,
  onTest,
  presentation,
}: AgentHttpEditorTabsProps) {
  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(event) => onActiveTabChange(event.value)}
      flex={1}
      display="flex"
      flexDirection="column"
      overflow="hidden"
      colorPalette="blue"
    >
      <Tabs.List paddingX={6} borderBottomWidth="1px" borderColor="border">
        <Tabs.Trigger value="body">Body</Tabs.Trigger>
        {showVariablesTab && <Tabs.Trigger value="variables">Variables</Tabs.Trigger>}
        <Tabs.Trigger value="auth">Auth</Tabs.Trigger>
        <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
        <Tabs.Trigger value="test">Test</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="body" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
        <VStack gap={6} align="stretch">
          <Field.Root>
            <Field.Label>Request Body Template</Field.Label>
            <Text fontSize="sm" color="fg.muted" marginBottom={2}>
              JSON body with mustache variables. Variables are replaced at runtime.
            </Text>
            <BodyTemplateEditor value={bodyTemplate} onChange={onBodyTemplateChange} />
          </Field.Root>
          <Field.Root>
            <Field.Label>Output Path (JSONPath)</Field.Label>
            <OutputPathInput value={outputPath} onChange={onOutputPathChange} />
          </Field.Root>
          {presentation.renderScenarioMappings({
            inputs: variables,
            mappings: scenarioMappings,
            onMappingChange: onScenarioMappingChange,
          })}
        </VStack>
      </Tabs.Content>

      {showVariablesTab && (
        <Tabs.Content value="variables" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
          <VStack gap={4} align="stretch">
            <Text fontSize="sm" color="fg.muted">
              Define variables to use in your body template (e.g.,{" "}
              <Text as="span" fontFamily="mono" bg="bg.subtle" paddingX={1}>
                {"{{input}}"}
              </Text>{" "}
              ) and map them to your evaluation dataset. At least one variable must be mapped.
            </Text>
            {presentation.renderVariables({
              variables,
              onChange: onVariablesChange,
              mappings: localMappings,
              onMappingChange,
              missingMappingIds,
              lockedVariableIds: fixedVariableIds,
            })}
            {!hasAtLeastOneMapping && (
              <Text data-testid="at-least-one-mapping-error" color="red.500" fontSize="sm">
                At least one variable must be mapped
              </Text>
            )}
          </VStack>
        </Tabs.Content>
      )}

      <Tabs.Content value="auth" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
        <AuthConfigSection value={auth} onChange={onAuthChange} />
      </Tabs.Content>

      <Tabs.Content value="headers" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
        <HeadersConfigSection value={headers} onChange={onHeadersChange} />
      </Tabs.Content>

      <Tabs.Content value="test" flex={1} overflowY="auto" paddingX={6} paddingY={4}>
        <HttpTestPanel
          onTest={onTest}
          url={url}
          method={method}
          headers={headers}
          outputPath={outputPath}
          bodyTemplate={bodyTemplate}
          explainError={presentation.explainTestError}
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}
