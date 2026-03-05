import { Box, Field, HStack, Input, Tabs, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import type {
  HttpAuth,
  HttpHeader,
  HttpMethod,
} from "~/optimization_studio/types/dsl";
import { AuthConfigSection } from "./AuthConfigSection";
import { BodyTemplateEditor } from "./BodyTemplateEditor";
import { HeadersConfigSection } from "./HeadersConfigSection";
import { HttpMethodSelector } from "./HttpMethodSelector";
import { HttpTestPanel, type HttpTestResult } from "./HttpTestPanel";
import { OutputPathInput } from "./OutputPathInput";

export type HttpConfigEditorProps = {
  url: string;
  onUrlChange: (url: string) => void;
  method: HttpMethod;
  onMethodChange: (method: HttpMethod) => void;
  bodyTemplate: string;
  onBodyTemplateChange: (body: string) => void;
  outputPath: string;
  onOutputPathChange: (path: string) => void;
  auth: HttpAuth | undefined;
  onAuthChange: (auth: HttpAuth | undefined) => void;
  headers: HttpHeader[];
  onHeadersChange: (headers: HttpHeader[]) => void;
  onTest: (requestBody: string) => Promise<HttpTestResult>;
  /** Horizontal padding for the endpoint and tab content areas. Defaults to 4. */
  paddingX?: number | string;
};

/**
 * Shared HTTP configuration editor with endpoint URL + method selector
 * and tabbed interface for Body, Auth, Headers, and Test.
 *
 * Used by HttpPropertiesPanel and AgentPropertiesPanel.
 */
export function HttpConfigEditor({
  url,
  onUrlChange,
  method,
  onMethodChange,
  bodyTemplate,
  onBodyTemplateChange,
  outputPath,
  onOutputPathChange,
  auth,
  onAuthChange,
  headers,
  onHeadersChange,
  onTest,
  paddingX = 4,
}: HttpConfigEditorProps) {
  const [activeTab, setActiveTab] = useState("body");

  return (
    <>
      {/* URL + Method */}
      <Box paddingX={paddingX}>
        <VStack align="stretch" gap={2} width="full">
          <Text fontWeight="medium" fontSize="sm">
            Endpoint
          </Text>
          <HStack gap={2}>
            <HttpMethodSelector value={method} onChange={onMethodChange} />
            <Input
              flex={1}
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://api.example.com/endpoint"
              fontFamily="mono"
              fontSize="13px"
              size="sm"
            />
          </HStack>
        </VStack>
      </Box>

      {/* Tabbed Content */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(e) => setActiveTab(e.value)}
        width="full"
        colorPalette="blue"
      >
        <Tabs.List
          paddingX={paddingX}
          borderBottomWidth="1px"
          borderColor="border"
        >
          <Tabs.Trigger value="body">Body</Tabs.Trigger>
          <Tabs.Trigger value="auth">Auth</Tabs.Trigger>
          <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
          <Tabs.Trigger value="test">Test</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="body" paddingX={paddingX} paddingY={3}>
          <VStack gap={4} align="stretch">
            <Field.Root>
              <Field.Label fontSize="sm">Request Body Template</Field.Label>
              <BodyTemplateEditor
                value={bodyTemplate}
                onChange={onBodyTemplateChange}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label fontSize="sm">Output Path (JSONPath)</Field.Label>
              <OutputPathInput
                value={outputPath}
                onChange={onOutputPathChange}
              />
            </Field.Root>
          </VStack>
        </Tabs.Content>

        <Tabs.Content value="auth" paddingX={paddingX} paddingY={3}>
          <AuthConfigSection value={auth} onChange={onAuthChange} />
        </Tabs.Content>

        <Tabs.Content value="headers" paddingX={paddingX} paddingY={3}>
          <HeadersConfigSection value={headers} onChange={onHeadersChange} />
        </Tabs.Content>

        <Tabs.Content value="test" paddingX={paddingX} paddingY={3}>
          <HttpTestPanel
            onTest={onTest}
            url={url}
            method={method}
            headers={headers}
            outputPath={outputPath}
            bodyTemplate={bodyTemplate}
          />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}
