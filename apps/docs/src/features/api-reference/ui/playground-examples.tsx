import { Box, Flex, Tabs, Text } from "@langwatch/design-system/primitives";
import { FileCode } from "lucide-react";

import { usePreference, writePreference } from "../../../lib/storage.ts";
import { type CodeSource, languageFamily } from "../../code/model.ts";
import { CodeBar, CodeBody, CopyAction } from "../../code/ui.ts";
import { readingTabList, readingTabTrigger, TextWithCode } from "../../content/ui.ts";
import { exampleFromSchema } from "../model/codegen.ts";
import { EXAMPLE_LANGUAGES } from "../model/operation.ts";
import type { Operation } from "../model/operation.ts";
import { plainSource } from "../model/playground-source.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import { Panel } from "./panel.tsx";

const REQUEST_FILES = { python: "request.py", typescript: "request.ts", curl: "request.sh" };
/** The agent prompt leads the strip; a reader with no stored choice still starts on Python. */
const AGENT_TAB = { id: "agent", label: "Agent prompt", file: "prompt.md" } as const;
const REQUEST_TABS = [
  AGENT_TAB,
  ...EXAMPLE_LANGUAGES.map((entry) => ({ ...entry, file: REQUEST_FILES[entry.id] })),
];

export function RequestExamples({
  examples,
  agent,
  reference,
}: {
  examples: Record<string, CodeSource>;
  agent: CodeSource;
  reference: string;
}) {
  const stored = usePreference({ key: "api-language" });
  const selected =
    REQUEST_TABS.find((entry) => entry.label.toLowerCase() === stored?.toLowerCase()) ??
    REQUEST_TABS[1];
  if (!selected) return null;
  const sources: Record<string, CodeSource | undefined> = { ...examples, agent };
  return (
    <Panel showHeader={false} title="Request example">
      <Tabs.Root
        data-docs-preference="api-language"
        value={selected.label}
        onValueChange={({ value }) => writePreference({ key: "api-language", value })}
        variant="line"
        colorPalette="accent"
        minWidth="0"
        maxWidth="100%"
      >
        <CodeBar>
          <FileCode size={16} aria-hidden="true" />
          <Text as="span" data-docs-code-title="" flex="1" fontFamily="mono" fontSize="13px">
            {selected.file}
          </Text>
          <CopyAction code={sources[selected.id]?.code ?? ""} />
        </CodeBar>
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
            {REQUEST_TABS.map((entry) => (
              <Tabs.Trigger
                key={entry.id}
                value={entry.label}
                data-docs-family={languageFamily({ label: entry.label }) ?? void 0}
                css={readingTabTrigger}
              >
                {entry.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Flex>
        {/* Panels keep the languages first; the agent prompt's panel follows them. */}
        {[...REQUEST_TABS.slice(1), AGENT_TAB].map((entry) => {
          const source = sources[entry.id];
          return (
            <Tabs.Content
              key={entry.id}
              value={entry.label}
              padding="0"
              data-docs-panel=""
              data-docs-example={entry.id}
              data-docs-reference={entry.id === AGENT_TAB.id ? reference : void 0}
              data-code-title={entry.file}
              bg="bg.nested"
              minWidth="0"
              maxWidth="100%"
              overflow="hidden"
            >
              {source ? <CodeBody source={source} /> : null}
            </Tabs.Content>
          );
        })}
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
  if (!response) return null;
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
  let exampleLabel = "No fields specified";
  if (exampleCode) exampleLabel = declared !== void 0 ? "Example" : "Generated from schema";
  return { chosen, chosenContent, exampleCode, exampleLabel };
}

/* The full description sits under Responses in the reference; here it is a two-line caption. */
function ResponseExampleBody({ response }: { response: Operation["responses"][number] }) {
  const { chosen, chosenContent, exampleCode, exampleLabel } = responseExampleData({ response });
  return (
    <>
      <Box paddingX="4" paddingTop="3" paddingBottom="3">
        {chosen?.description ? (
          <Text
            margin="0"
            fontSize="13px"
            lineHeight="20px"
            color="docs.body"
            lineClamp="2"
            title={chosen.description.replaceAll("`", "")}
          >
            <TextWithCode text={chosen.description} />
          </Text>
        ) : null}
        {chosenContent ? (
          <Text
            margin="0"
            marginTop={chosen?.description ? "1.5" : "0"}
            fontSize="12px"
            lineHeight="16px"
            color="fg.muted"
          >
            <Box as="span" fontFamily="mono">
              {chosenContent.type}
            </Box>
            {" · "}
            {exampleLabel}
          </Text>
        ) : null}
      </Box>
      {exampleCode ? (
        <Box bg="bg.nested" borderTopWidth="1px" borderColor="border.nested">
          <CodeBody source={plainSource({ code: exampleCode })} />
        </Box>
      ) : null}
    </>
  );
}
