import { Box, Flex, Tabs, Text } from "@langwatch/design-system/primitives";

import { CodeBody, CopyAction } from "../code/code-parts.tsx";
import type { CodeSource } from "../code/code-parts.tsx";
import { usePreference, writePreference } from "../lib/storage.ts";
import { readingTabList, readingTabTrigger } from "../mdx-components/tabs.tsx";
import { exampleFromSchema } from "./codegen.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import { EXAMPLE_LANGUAGES } from "./operation.ts";
import type { Operation } from "./operation.ts";
import { Panel } from "./panel.tsx";
import { plainSource } from "./playground-source.ts";

export function RequestExamples({ examples }: { examples: Record<string, CodeSource> }) {
  const stored = usePreference({ key: "api-language" });
  const selected =
    EXAMPLE_LANGUAGES.find((entry) => entry.label.toLowerCase() === stored?.toLowerCase()) ??
    EXAMPLE_LANGUAGES[0];
  const language = selected.id;
  const languageLabel = selected.label;
  return (
    <Panel showHeader={false} title="Request example">
      <Tabs.Root
        data-docs-preference="api-language"
        value={languageLabel}
        onValueChange={({ value }) => writePreference({ key: "api-language", value })}
        variant="line"
        colorPalette="accent"
        minWidth="0"
        maxWidth="100%"
      >
        <Flex
          alignItems="center"
          borderBottomWidth="1px"
          borderColor="border.nested"
          paddingX="2"
          bg="bg.subtle"
        >
          <Tabs.List
            css={{
              ...readingTabList,
              flex: 1,
              minWidth: 0,
              borderBottomWidth: 0,
              boxShadow: "none",
            }}
          >
            {EXAMPLE_LANGUAGES.map((entry) => (
              <Tabs.Trigger key={entry.id} value={entry.label} css={readingTabTrigger}>
                {entry.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <CopyAction code={examples[language].code} />
        </Flex>
        {EXAMPLE_LANGUAGES.map((entry) => (
          <Tabs.Content
            key={entry.id}
            value={entry.label}
            padding="0"
            data-docs-panel=""
            bg="bg.nested"
            minWidth="0"
            maxWidth="100%"
            overflow="hidden"
          >
            <CodeBody source={examples[entry.id]} />
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </Panel>
  );
}

export function ResponseExample({ operation }: { operation: Operation }) {
  const { status, setStatus } = useEndpointState();
  const statuses = operation.responses.map((response) => response.status);
  if (statuses.length === 0) return null;
  const response =
    operation.responses.find((entry) => entry.status === status) ?? operation.responses[0];
  const { exampleCode } = responseExampleData({ response });
  return (
    <Panel showHeader={false} title="Documented response">
      <Flex
        alignItems="center"
        bg="bg.subtle"
        borderBottomWidth="1px"
        borderColor="border"
        paddingInlineEnd="2"
      >
        <Tabs.Root
          value={status}
          onValueChange={({ value }) => setStatus(value)}
          variant="line"
          colorPalette="accent"
          minWidth="0"
          flex="1"
        >
          <Tabs.List
            aria-label="Response status"
            css={{ ...readingTabList, paddingInline: "8px", borderBottomWidth: "0" }}
          >
            {statuses.map((entry) => (
              <Tabs.Trigger
                key={entry}
                value={entry}
                css={{ ...readingTabTrigger, paddingX: "2", fontSize: "12px" }}
              >
                {entry}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <CopyAction code={exampleCode} label="Copy example" hidden={!exampleCode} />
      </Flex>
      {operation.responses.map((response) => (
        <div
          key={response.status}
          data-response-status={response.status}
          data-docs-panel=""
          hidden={response.status !== status}
        >
          <ResponseExampleBody response={response} />
        </div>
      ))}
    </Panel>
  );
}

function responseExampleData({ response }: { response: Operation["responses"][number] }) {
  const chosen = response;
  const chosenContent = chosen.contents[0];
  const declared = chosenContent?.example;
  const example =
    declared ??
    (chosenContent?.schema ? exampleFromSchema({ schema: chosenContent.schema }) : void 0);
  const exampleCode =
    example === void 0 || example === null || JSON.stringify(example) === "{}"
      ? ""
      : JSON.stringify(example, null, 2);
  let exampleLabel = "Response fields are not specified";
  if (exampleCode) exampleLabel = declared !== void 0 ? "Declared example" : "Example from schema";
  return { chosen, chosenContent, exampleCode, exampleLabel };
}

function ResponseExampleBody({ response }: { response: Operation["responses"][number] }) {
  const { chosen, chosenContent, exampleCode, exampleLabel } = responseExampleData({ response });
  return (
    <>
      <Box paddingX="4" paddingTop="3" fontSize="12px" lineHeight="18px" color="fg.muted">
        <Text margin="0">{chosen?.description}</Text>
        {chosenContent ? (
          <Text margin="0">
            {exampleLabel} · {chosenContent.type}
          </Text>
        ) : null}
      </Box>
      {exampleCode ? (
        <Box marginTop="3" bg="bg.nested" borderTopWidth="1px" borderColor="border.nested">
          <CodeBody source={plainSource({ code: exampleCode })} />
        </Box>
      ) : (
        <Box height="3" />
      )}
    </>
  );
}
