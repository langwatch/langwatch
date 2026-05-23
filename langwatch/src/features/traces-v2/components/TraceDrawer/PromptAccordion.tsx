import {
  Badge,
  Box,
  Button,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import {
  LuCopy,
  LuExternalLink,
  LuPencil,
} from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import { Link } from "~/components/ui/link";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  extractPromptReference,
  hasPromptMetadata,
} from "../../utils/promptAttributes";
import { usePromptByHandle } from "../../hooks/usePromptByHandle";

export { hasPromptMetadata };

interface PromptAccordionProps {
  span: SpanDetail;
}

/**
 * Span-level prompt panel. Renders whatever's available so the section
 * pulls its weight even when only some `langwatch.prompt.*` keys made it
 * onto the span. The trace-level Prompts tab is the rollup view; this is
 * the per-span deep dive.
 *
 * Always renders on `llm` spans, even when no prompt metadata exists —
 * the "Open in Playground" action still works (it creates a brand-new
 * playground tab from the LLM span's input/output) so operators can
 * continue any LLM call regardless of whether a managed prompt was tied
 * to it. Mirrors the old SpanDetails behaviour.
 */
export function PromptAccordion({ span }: PromptAccordionProps) {
  const { openDrawer } = useDrawer();
  const ref = useMemo(() => extractPromptReference(span.params), [span]);
  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();
  // SDK sometimes emits the opaque slug-id (`prompt_xxx`) instead of the
  // human handle (`pizza-prompt`) on `langwatch.prompt.id`. Resolve to the
  // friendlier handle for display while keeping the raw value for the
  // playground deep-link.
  const { resolvedHandle } = usePromptByHandle(ref?.handle ?? null);

  const variableEntries = ref?.variables
    ? Object.entries(ref.variables).sort(([a], [b]) => a.localeCompare(b))
    : [];

  const rawHandle = ref?.handle ?? null;
  const displayHandle = resolvedHandle ?? rawHandle;

  // No-prompt llm spans don't reach this component anymore (the IOViewer
  // header carries the Playground affordance for that case). When we do
  // render and only partial metadata is present, fall back to a hint
  // instead of an empty section.
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

  return (
    <VStack align="stretch" gap={3} paddingY={2}>
      {/* Header */}
      <HStack gap={2} paddingX={2}>
        <Text
          textStyle="sm"
          fontWeight="bold"
          color={displayHandle ? "fg" : "fg.muted"}
        >
          {displayHandle ?? "Prompt (no handle on span)"}
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
        {ref?.draft && (
          // The executed config diverged from the saved version (user
          // edited inline without saving). Surfaced as an amber chip so
          // operators know clicking "Open prompt" lands on the BASE
          // version, not the diverged messages in the trace.
          <Badge size="sm" variant="subtle" colorPalette="orange">
            unsaved edits
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
      {rawHandle && (
        <HStack gap={1} paddingX={2}>
          <Button
            size="xs"
            variant="ghost"
            gap={1}
            onClick={() => openDrawer("promptEditor", { promptId: rawHandle })}
          >
            <Icon as={LuPencil} boxSize={3} />
            Open prompt
          </Button>
          {/* Single smart-default button: server resolves to the
              linked llm when this span isn't an llm itself
              (Prompt.compile, PromptApiService.get), opens the
              existing prompt at the traced version when one is
              linked, or creates a fresh tab otherwise. Same
              affordance the IOViewer header carries on llm spans —
              kept identical here so behavior is predictable
              wherever a prompt is surfaced. */}
          {buildUrl(span.spanId) && (
            <Link
              href={buildUrl(span.spanId)?.toString() ?? ""}
              isExternal
              variant="plain"
            >
              <Button size="xs" variant="ghost" gap={1}>
                <Icon as={LuExternalLink} boxSize={3} />
                Open in Playground
              </Button>
            </Link>
          )}
        </HStack>
      )}
    </VStack>
  );
}
