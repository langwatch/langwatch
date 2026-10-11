import { TypeRegion } from "../lib/type-mode.tsx";
import { Box, Flex, Tabs, Text } from "@langwatch/design-system/primitives";
import { useState } from "react";
import { CodeFrame } from "../code/code-block.tsx";
import { CodeBody } from "../code/code-parts.tsx";
import type { CodeSource } from "../code/code-parts.tsx";
import { exampleFromSchema } from "./codegen.ts";
import { MethodBadge } from "./method-badge.tsx";
import type { Operation } from "./operation.ts";
import { ParameterFields, SchemaFields, SchemaNote } from "./schema.tsx";
import { readingTabList, readingTabTrigger } from "../mdx-components/tabs.tsx";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box as="section" marginTop="10">
      <Text as="h2" margin="0" paddingBottom="2" fontSize="var(--docs-h2-size)" lineHeight="var(--docs-h2-line)" fontWeight="var(--docs-weight-heading)" fontFamily="var(--docs-font-heading)" borderBottomWidth="1px" borderColor="border.muted">
        {title}
      </Text>
      {children}
    </Box>
  );
}

export function EndpointSummary({ operation }: { operation: Operation }) {
  return (
    <Flex alignItems="center" gap="3" wrap="wrap" marginTop="6">
      <MethodBadge method={operation.method} />
      <Box as="code" fontFamily="mono" fontSize="14px" lineHeight="24px" overflowWrap="anywhere" wordBreak="break-word" css={{ userSelect: "all" }}>
        {operation.path}
      </Box>
    </Flex>
  );
}

function ResponseExample({ source }: { source: CodeSource }) {
  return (
    <Box marginTop="3">
      <Text margin="0" marginBottom="1" fontSize="12px" color="fg.muted">
        Example from schema
      </Text>
      <CodeFrame>
        <CodeBody source={source} expanded={false} />
      </CodeFrame>
    </Box>
  );
}

function plain({ code }: { code: string }): CodeSource {
  return { lang: "json", title: "Example", code, lines: code.split("\n").map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;")), highlight: [], numbered: false };
}

export function Responses({ operation }: { operation: Operation }) {
  const statuses = operation.responses.map((response) => response.status);
  const first = statuses.find((status) => status.startsWith("2")) ?? statuses[0] ?? "";
  const [active, setActive] = useState(first);
  if (statuses.length === 0) return null;
  return (
    <Section title="Responses">
      <Tabs.Root value={active} onValueChange={({ value }) => setActive(value)} variant="line" colorPalette="accent" marginTop="2">
        <Tabs.List css={readingTabList} aria-label="Response status">
          {statuses.map((status) => (
            <Tabs.Trigger key={status} value={status} css={readingTabTrigger}>
              {status}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {operation.responses.map((response) => {
          const content = response.contents[0];
          const example = content?.example ?? (content?.schema && Object.keys(content.schema.properties ?? {}).length > 0 ? exampleFromSchema({ schema: content.schema }) : undefined);
          return (
            <Tabs.Content key={response.status} value={response.status} paddingX="0" paddingTop="4" data-docs-panel="">
              <Text margin="0" fontSize="16px" lineHeight="28px">
                {response.description}
              </Text>
              {content ? <Text margin="0" fontSize="12px" color="fg.muted">{content.type}</Text> : null}
              {content?.schema ? (
                Object.keys(content.schema.properties ?? {}).length > 0 ? (
                  <SchemaFields schema={content.schema} />
                ) : (
                  <SchemaNote schema={content.schema} />
                )
              ) : null}
              {example !== undefined && content?.schema && Object.keys(content.schema.properties ?? {}).length > 0 ? (
                <ResponseExample source={plain({ code: JSON.stringify(example, null, 2) })} />
              ) : null}
            </Tabs.Content>
          );
        })}
      </Tabs.Root>
    </Section>
  );
}

export function EndpointReference({ operation, children }: { operation: Operation; children?: React.ReactNode }) {
  const groups = [
    { title: "Path parameters", params: operation.parameters.filter((param) => param.in === "path") },
    { title: "Query parameters", params: operation.parameters.filter((param) => param.in === "query") },
    { title: "Headers", params: operation.parameters.filter((param) => param.in === "header") },
  ].filter((group) => group.params.length > 0);
  const bodyContent = operation.body?.contents[0];
  return (
    <TypeRegion mode="productive">
      {operation.schemes.length > 0 ? (
        <Section title="Authorisation">
          {operation.schemes.map((scheme) => (
            <Box key={scheme.id} paddingY="4" fontSize="14px" lineHeight="24px">
              <Box as="code" fontFamily="mono" fontWeight="600">
                {scheme.type === "apiKey" ? scheme.name : "Authorization: Bearer"}
              </Box>{" "}
              <Text as="span" color="fg.muted">
                from {scheme.id}
              </Text>
              {scheme.description ? (
                <Text margin="0" color="fg.muted">
                  {scheme.description}
                </Text>
              ) : null}
            </Box>
          ))}
        </Section>
      ) : null}
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          <ParameterFields parameters={group.params} />
        </Section>
      ))}
      {operation.body && bodyContent?.schema ? (
        <Section title="Request body">
          <Text margin="0" paddingTop="3" fontSize="12px" color="fg.muted">
            {bodyContent.type}
            {operation.body.required ? " · Required" : ""}
          </Text>
          {Object.keys(bodyContent.schema.properties ?? {}).length > 0 ? <SchemaFields schema={bodyContent.schema} /> : <SchemaNote schema={bodyContent.schema} />}
        </Section>
      ) : null}
      <Responses operation={operation} />
      {children ? <TypeRegion mode="expressive" className="docs-prose" marginTop="10">{children}</TypeRegion> : null}
    </TypeRegion>
  );
}
