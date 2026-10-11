import { TypeRegion } from "../lib/type-mode.tsx";
import { Box, Button, Flex, Tabs, Text } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";
import { useEndpointState } from "./endpoint-state.tsx";
import { MethodBadge } from "./method-badge.tsx";
import type { Operation } from "./operation.ts";
import { ParameterFields, SchemaFields, SchemaNote } from "./schema.tsx";
import { readingTabList, readingTabTrigger } from "../mdx-components/tabs.tsx";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box as="section" marginTop="10">
      <Text as="h2" margin="0" paddingBottom="3" fontSize="var(--docs-h2-size)" lineHeight="var(--docs-h2-line)" fontWeight="var(--docs-weight-heading)" fontFamily="var(--docs-font-heading)" letterSpacing="var(--docs-heading-tracking)" borderBottomWidth="1px" borderColor="border.muted">
        {title}
      </Text>
      {children}
    </Box>
  );
}

export function EndpointSummary({ operation }: { operation: Operation }) {
  const { tryOpen, setTryOpen } = useEndpointState();
  return (
    <Flex
      alignItems="center"
      gap="3"
      wrap="wrap"
      marginTop="6"
      padding="2"
      paddingInlineStart="3"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      bg="bg.panel"
    >
      <MethodBadge method={operation.method} />
      <Box as="code" flex="1" minWidth="0" fontFamily="mono" fontSize="13px" lineHeight="20px" overflowWrap="anywhere" wordBreak="break-word" css={{ userSelect: "all" }}>
        {operation.path}
      </Box>
      <Button
        id="try-it-button"
        type="button"
        aria-expanded={tryOpen}
        aria-controls="try-it-form"
        onClick={() => setTryOpen(!tryOpen)}
        height="40px"
        paddingX="4"
        borderRadius="full"
        bg="fg"
        color="fg.inverted"
        fontWeight="500"
        fontSize="13px"
        _hover={{ bg: "fg", opacity: 0.9 }}
        width={{ base: "100%", md: "auto" }}
      >
        Try it <Play size={12} aria-hidden="true" />
      </Button>
    </Flex>
  );
}

export function Responses({ operation }: { operation: Operation }) {
  const statuses = operation.responses.map((response) => response.status);
  const { status: active, setStatus: setActive } = useEndpointState();
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
