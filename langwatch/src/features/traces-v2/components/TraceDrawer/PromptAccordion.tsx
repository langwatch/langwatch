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
  LuChevronDown,
  LuCopy,
  LuExternalLink,
  LuPencil,
  LuPlay,
} from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
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
  const isLlmSpan = span.type === "llm";
  const promptRefLabel =
    rawHandle && ref?.versionNumber != null
      ? `${rawHandle}:${ref.versionNumber}`
      : rawHandle && ref?.tag
        ? `${rawHandle}:${ref.tag}`
        : rawHandle;

  // The accordion is mounted in two situations:
  //   (a) span has prompt metadata of its own (handle/variables) — render
  //       the full pane with the Open-in-Prompts menu.
  //   (b) span is an `llm` with no metadata — surface only the "Open in
  //       Playground" affordance so operators can still continue the
  //       conversation; nothing else to show.
  if (!ref && variableEntries.length === 0) {
    if (isLlmSpan) {
      return (
        <VStack align="stretch" gap={2} paddingY={2}>
          <Text textStyle="xs" color="fg.muted" paddingX={2}>
            No managed prompt detected on this LLM call. You can still open
            it in the Playground to continue the conversation.
          </Text>
          <HStack gap={1} paddingX={2}>
            <Link
              href={buildUrl(span.spanId, "create-new")?.toString() ?? ""}
              isExternal
            >
              <Button size="xs" variant="ghost" gap={1}>
                <Icon as={LuPlay} boxSize={3} />
                Open in Playground
              </Button>
            </Link>
          </HStack>
        </VStack>
      );
    }
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
          {isLlmSpan && (
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="xs" variant="ghost" gap={1}>
                  <Icon as={LuExternalLink} boxSize={3} />
                  Open in Playground
                  <Icon as={LuChevronDown} boxSize={2.5} />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item value="open-existing" asChild>
                  <Link
                    href={
                      buildUrl(span.spanId, "open-existing")?.toString() ?? ""
                    }
                    isExternal
                  >
                    Open {promptRefLabel ?? "prompt"}
                  </Link>
                </Menu.Item>
                <Menu.Item value="create-new" asChild>
                  <Link
                    href={
                      buildUrl(span.spanId, "create-new")?.toString() ?? ""
                    }
                    isExternal
                  >
                    Create new prompt
                  </Link>
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>
      )}
    </VStack>
  );
}
