import { useMemo } from "react";
import {
  Badge,
  Box,
  Button,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { LuCopy, LuExternalLink, LuPencil } from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  extractPromptReference,
  hasPromptMetadata,
} from "../../utils/promptAttributes";

export { hasPromptMetadata };

interface PromptAccordionProps {
  span: SpanDetail;
}

/**
 * Span-level prompt panel. Renders whatever's available so the section
 * pulls its weight even when only some `langwatch.prompt.*` keys made it
 * onto the span. The trace-level Prompts tab is the rollup view; this is
 * the per-span deep dive.
 */
export function PromptAccordion({ span }: PromptAccordionProps) {
  const { openDrawer } = useDrawer();
  const ref = useMemo(() => extractPromptReference(span.params), [span]);

  const variableEntries = ref?.variables
    ? Object.entries(ref.variables).sort(([a], [b]) => a.localeCompare(b))
    : [];

  // Section visibility is gated upstream by `hasPromptMetadata`, so we
  // get here whenever any `langwatch.prompt.*` key exists. When the
  // reference itself didn't parse (variables-only, or a bare slug we
  // can't parse without a handle key) we still surface the variables —
  // partial info beats an empty section.
  if (!ref && variableEntries.length === 0) {
    return (
      <Box paddingX={2} paddingY={3}>
        <Text textStyle="xs" color="fg.muted">
          Span carries prompt metadata but no parseable handle or variables —
          likely an incomplete SDK emit.
        </Text>
      </Box>
    );
  }

  const handle = ref?.handle ?? null;

  return (
    <VStack align="stretch" gap={3} paddingY={2}>
      {/* Header */}
      <HStack gap={2} paddingX={2}>
        <Text
          textStyle="sm"
          fontWeight="bold"
          fontFamily="mono"
          color={handle ? "fg" : "fg.muted"}
        >
          {handle ?? "Prompt (no handle on span)"}
        </Text>
        {ref?.versionNumber != null && (
          <Badge size="sm" variant="subtle">
            v{ref.versionNumber}
          </Badge>
        )}
        {ref?.tag != null && (
          <Badge size="sm" variant="outline" colorPalette="blue">
            {ref.tag}
          </Badge>
        )}
      </HStack>

      {/* Variables */}
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
                  transition="color 0.12s ease, font-weight 0.12s ease"
                  css={{
                    ".prompt-var-row:hover &": {
                      color: "fg",
                      fontWeight: "semibold",
                    },
                  }}
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

      {/* Actions */}
      {handle && (
        <HStack gap={1} paddingX={2}>
          <Button
            size="xs"
            variant="ghost"
            gap={1}
            onClick={() => openDrawer("promptEditor", { promptId: handle })}
          >
            <Icon as={LuPencil} boxSize={3} />
            Open prompt
          </Button>
          {/* Playground action stays disabled until the playground drawer
              accepts span input + variables as deep-link params. */}
          <Button size="xs" variant="ghost" gap={1} disabled>
            <Icon as={LuExternalLink} boxSize={3} />
            Open in Playground
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
