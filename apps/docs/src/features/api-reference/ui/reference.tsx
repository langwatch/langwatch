import { Box, Button, Flex, Text } from "@langwatch/design-system/primitives";
import { Play } from "lucide-react";

import { TypeRegion } from "../../../lib/type-mode.tsx";
import { DocsField } from "../../content/ui/fields.tsx";
import type { Operation } from "../model/operation.ts";
import { useEndpointState } from "./endpoint-state.tsx";
import { MethodBadge } from "./method-badge.tsx";
import { ParameterFields, SchemaFields } from "./schema.tsx";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box as="section" id={title.toLowerCase().replaceAll(" ", "-")} marginTop="8">
      <Text
        as="h2"
        margin="0"
        paddingBottom="3"
        fontSize="18px"
        lineHeight="var(--docs-h2-line)"
        fontWeight="var(--docs-weight-heading)"
        fontFamily="var(--docs-font-heading)"
        letterSpacing="var(--docs-heading-tracking)"
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
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
      className="docs-method-bar"
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
      <Box
        as="code"
        flex="1"
        minWidth="0"
        fontFamily="mono"
        fontSize="13px"
        lineHeight="20px"
        overflowWrap="anywhere"
        wordBreak="break-word"
        css={{ userSelect: "all" }}
      >
        {operation.path.split(/(\{[^}]+\}|\/)/).map((part, index) =>
          part.startsWith("{") ? (
            <Box
              as="span"
              key={index}
              bg="green.subtle"
              color="green.fg"
              borderRadius="sm"
              paddingX="1"
              paddingY="0.5"
            >
              {part}
            </Box>
          ) : (
            <Box
              as="span"
              key={index}
              color={part === "/" || /^v\d+$/.test(part) ? "fg.muted" : "blue.fg"}
            >
              {part}
            </Box>
          ),
        )}
      </Box>
      <Button
        id="try-it-button"
        type="button"
        aria-expanded={tryOpen}
        aria-controls="try-it-form"
        onClick={() => setTryOpen(!tryOpen)}
        height="40px"
        paddingX="4"
        borderRadius="lg"
        bg="docs.action"
        color="docs.actionText"
        fontWeight="500"
        fontSize="13px"
        _hover={{ bg: "docs.action", opacity: 0.9 }}
        width={{ base: "100%", md: "auto" }}
      >
        Try it <Play size={12} aria-hidden="true" />
      </Button>
    </Flex>
  );
}

export function Responses({ operation }: { operation: Operation }) {
  if (operation.responses.length === 0) return null;
  return (
    <Section title="Responses">
      {operation.responses.map((response) => (
        <Box key={response.status} paddingY="3" borderBottomWidth="1px" borderColor="border.muted">
          <Flex gap="3" alignItems="baseline">
            <Box
              as="code"
              fontFamily="mono"
              fontSize="13px"
              color={response.status.startsWith("2") ? "green.fg" : "fg.muted"}
            >
              {response.status}
            </Box>
            <Text margin="0" fontSize="14px" lineHeight="22px" color="docs.body">
              {response.description}
            </Text>
          </Flex>
          {response.contents.map((content) =>
            content.schema ? (
              <Box key={content.type}>
                <Text margin="0" paddingTop="3" fontSize="12px" color="fg.muted">
                  {content.type}
                </Text>
                <SchemaFields schema={content.schema} />
              </Box>
            ) : null,
          )}
        </Box>
      ))}
    </Section>
  );
}

export function EndpointReference({
  operation,
  children,
}: {
  operation: Operation;
  children?: React.ReactNode;
}) {
  const groups = [
    {
      title: "Path parameters",
      params: operation.parameters.filter((param) => param.in === "path"),
    },
    {
      title: "Query parameters",
      params: operation.parameters.filter((param) => param.in === "query"),
    },
    { title: "Headers", params: operation.parameters.filter((param) => param.in === "header") },
  ].filter((group) => group.params.length > 0);
  const bodyContent = operation.body?.contents[0];
  return (
    <TypeRegion mode="productive">
      {operation.schemes.length > 0 ? (
        <Section title="Authorisation">
          {operation.schemes.map((scheme) => (
            <DocsField
              key={scheme.id}
              name={scheme.type === "apiKey" ? scheme.name : "Authorization"}
              type="string"
              location={scheme.in ?? "header"}
              required
            >
              {scheme.description ? <p>{scheme.description}</p> : null}
            </DocsField>
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
          <SchemaFields schema={bodyContent.schema} />
        </Section>
      ) : null}
      <Responses operation={operation} />
      {children ? (
        <TypeRegion mode="expressive" className="docs-prose" marginTop="14">
          {children}
        </TypeRegion>
      ) : null}
    </TypeRegion>
  );
}
