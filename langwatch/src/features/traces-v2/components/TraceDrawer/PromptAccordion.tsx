import { useMemo } from "react";
import { Badge, Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCopy, LuExternalLink, LuPencil } from "react-icons/lu";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";

const PROMPT_PREFIX = "langwatch.prompt.";

export function hasPromptMetadata(
  params: Record<string, unknown> | null | undefined,
): boolean {
  if (!params) return false;
  return Object.keys(params).some((key) => key.startsWith(PROMPT_PREFIX));
}

interface PromptData {
  handle: string | null;
  versionNumber: number | null;
  tag: string | null;
  variables: Record<string, string> | null;
}

/**
 * Parses prompt reference data from flat span attributes.
 *
 * Supports two formats:
 * 1. Combined: `langwatch.prompt.id = "handle:version_or_tag"`
 * 2. Separate: `langwatch.prompt.handle` + `langwatch.prompt.version.number`
 *
 * Variables use a wrapped JSON format: `{"type":"json","value":{"key":"val"}}`
 */
function extractPromptData(params: Record<string, unknown>): PromptData {
  const variables = parsePromptVariables(params);

  // Try combined format first: langwatch.prompt.id = "handle:version_or_tag"
  const promptId = params["langwatch.prompt.id"];
  if (typeof promptId === "string" && promptId.includes(":")) {
    const colonIndex = promptId.lastIndexOf(":");
    const slug = promptId.substring(0, colonIndex);
    const suffix = promptId.substring(colonIndex + 1);

    if (slug.length > 0 && suffix.length > 0 && suffix !== "latest") {
      const parsed = Number(suffix);
      if (Number.isInteger(parsed) && parsed > 0) {
        return { handle: slug, versionNumber: parsed, tag: null, variables };
      }
      return { handle: slug, versionNumber: null, tag: suffix, variables };
    }

    if (slug.length > 0) {
      return { handle: slug, versionNumber: null, tag: null, variables };
    }
  }

  // Try old separate format
  const handle = params["langwatch.prompt.handle"];
  const versionRaw = params["langwatch.prompt.version.number"];

  if (typeof handle === "string" && handle.length > 0) {
    if (versionRaw != null) {
      const version = Number(versionRaw);
      if (Number.isInteger(version) && version > 0) {
        return { handle, versionNumber: version, tag: null, variables };
      }
    }
    return { handle, versionNumber: null, tag: null, variables };
  }

  return { handle: null, versionNumber: null, tag: null, variables };
}

function parsePromptVariables(
  params: Record<string, unknown>,
): Record<string, string> | null {
  const raw = params["langwatch.prompt.variables"];
  if (typeof raw !== "string") return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("value" in parsed)) {
      return null;
    }

    const value = (parsed as { value: unknown }).value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }

    const result: Record<string, string> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = String(val);
    }
    return result;
  } catch {
    return null;
  }
}

interface PromptAccordionProps {
  span: SpanDetail;
}

export function PromptAccordion({ span }: PromptAccordionProps) {
  const prompt = useMemo(() => {
    if (!span.params) return null;
    if (!hasPromptMetadata(span.params)) return null;
    return extractPromptData(span.params);
  }, [span]);

  if (!prompt) return null;

  const variableEntries = prompt.variables
    ? Object.entries(prompt.variables).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <VStack align="stretch" gap={3} paddingY={2}>
      {/* Header row */}
      <HStack gap={2} paddingX={2}>
        <Text textStyle="sm" fontWeight="bold" fontFamily="mono" color="fg">
          {prompt.handle ?? "Unknown Prompt"}
        </Text>
        {prompt.versionNumber != null && (
          <Badge size="sm" variant="subtle">
            v{prompt.versionNumber}
          </Badge>
        )}
        {prompt.tag != null && (
          <Badge size="sm" variant="outline" colorPalette="blue">
            {prompt.tag}
          </Badge>
        )}
      </HStack>

      {/* Variables table */}
      {variableEntries.length > 0 && (
        <VStack align="stretch" gap={0}>
          <Text
            textStyle="xs"
            fontWeight="semibold"
            color="fg.muted"
            textTransform="uppercase"
            letterSpacing="0.08em"
            marginBottom={1}
            paddingX={2}
          >
            Variables
          </Text>
          <Box
            bg="bg.subtle"
            borderRadius="md"
            borderWidth="1px"
            borderColor="border"
            overflow="hidden"
          >
            {variableEntries.map(([key, val], i) => (
              <HStack
                key={key}
                paddingX={3}
                paddingY={1.5}
                borderBottomWidth={
                  i < variableEntries.length - 1 ? "1px" : "0px"
                }
                borderColor="border.muted"
                _hover={{ bg: "bg.muted" }}
                gap={3}
                className="prompt-var-row"
              >
                <Text
                  width="120px"
                  flexShrink={0}
                  textStyle="xs"
                  fontFamily="mono"
                  color="fg.muted"
                >
                  {key}
                </Text>
                <Text
                  flex={1}
                  textStyle="xs"
                  fontFamily="mono"
                  color="fg"
                  truncate
                  minWidth={0}
                >
                  {val}
                </Text>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(val)}
                  aria-label={`Copy ${key}`}
                  padding={0}
                  minWidth="auto"
                  height="auto"
                  opacity={0}
                  css={{ ".prompt-var-row:hover &": { opacity: 1 } }}
                >
                  <Icon as={LuCopy} boxSize={2.5} color="fg.subtle" />
                </Button>
              </HStack>
            ))}
          </Box>
        </VStack>
      )}

      {/* Actions row */}
      <HStack gap={1} paddingX={2}>
        <Button size="xs" variant="ghost" gap={1}>
          <Icon as={LuExternalLink} boxSize={3} />
          Open in Playground
        </Button>
        <Button size="xs" variant="ghost" gap={1}>
          <Icon as={LuPencil} boxSize={3} />
          Edit
        </Button>
      </HStack>
    </VStack>
  );
}
