import {
  Badge,
  Box,
  chakra,
  HoverCard,
  HStack,
  Icon,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { CircleHelp } from "lucide-react";
import type React from "react";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import type { TraceListItem } from "../../../../../types/trace";
import { abbreviateModel } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";
import { FilterChip } from "../FilterChip";

// When the +N popover would otherwise render a wall of model names,
// cap the visible list and direct the user to the drawer for the rest.
// Ten fits in a comfortable column-of-rows without scrolling on a
// dense table; tune if the trace ecosystem starts producing wider
// model mixes.
const EXTRA_MODELS_VISIBLE_CAP = 10;

type Density = "compact" | "comfortable";

type ProviderKey = keyof typeof modelProviderIcons;

/**
 * Map a model string to one of the known provider icons. Handles both
 * the prefixed form ("openai/gpt-5") and bare model names (the trace
 * collector frequently records just the model id without a provider
 * prefix) via prefix sniffing on the model name itself. Returns null
 * when we can't tell — the cell falls back to the plain text label.
 */
function inferProvider(model: string): ProviderKey | null {
  if (!model) return null;
  const slash = model.indexOf("/");
  if (slash > 0) {
    const candidate = model.slice(0, slash).toLowerCase();
    if (candidate in modelProviderIcons) return candidate as ProviderKey;
  }
  const lower = (slash > 0 ? model.slice(slash + 1) : model).toLowerCase();
  if (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.startsWith("text-embedding-") ||
    lower.startsWith("dall-e") ||
    lower.startsWith("whisper") ||
    lower.startsWith("chatgpt-")
  ) {
    return "openai";
  }
  if (lower.startsWith("claude-") || lower.startsWith("claude/")) {
    return "anthropic";
  }
  if (
    lower.startsWith("gemini-") ||
    lower.startsWith("gemma-") ||
    lower.startsWith("text-bison")
  ) {
    return "gemini";
  }
  if (lower.startsWith("deepseek-")) return "deepseek";
  if (lower.startsWith("grok-") || lower.startsWith("xai")) return "xai";
  if (lower.startsWith("groq")) return "groq";
  if (lower.includes("bedrock") || lower.startsWith("anthropic.claude")) {
    return "bedrock";
  }
  if (lower.startsWith("cerebras")) return "cerebras";
  return null;
}

/**
 * Provider icons that are flat monochrome marks — they ship with a
 * hardcoded near-black fill (or with no `fill` at all, so they
 * inherit `currentColor` which is `fg.muted` in our table cell).
 * On the dark theme that lands as dark-grey-on-dark, near-invisible.
 *
 * The fix: invert these icons in dark mode via a CSS filter. This is
 * a wrapper-level fix because the SVG components are shared with
 * other surfaces (the model picker, the docs site) that we don't want
 * to touch — only the trace-cell consumer needs the dark adapt.
 *
 * Coloured-brand icons (Groq orange, AWS yellow, GoogleCloud
 * primaries, Cerebras orange) are left alone — they're brand-coloured
 * marks that read well in both modes already.
 */
const MONOCHROME_PROVIDER_ICONS = new Set<ProviderKey>([
  "openai",
  "anthropic",
  "voyage",
  "custom",
]);

/**
 * Tiny provider mark rendered before the model name in the table cell.
 * Smaller than the model selector's `MODEL_ICON_SIZE` (which targets a
 * touch-friendly dropdown row) — the trace table row is dense, so the
 * icon stays at 12px / 14px so it complements the mono label without
 * dominating it.
 */
export function ProviderIcon({
  model,
  size,
}: {
  model: string;
  size: "compact" | "comfortable";
}) {
  const provider = inferProvider(model);
  if (!provider) return null;
  const icon = modelProviderIcons[provider];
  if (!icon) return null;
  const px = size === "comfortable" ? "14px" : "12px";
  const isMonochrome = MONOCHROME_PROVIDER_ICONS.has(provider);
  return (
    <Box
      width={px}
      height={px}
      flexShrink={0}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      // Provider SVGs ship as currentColor-ish marks at native size; the
      // wrapper Box constrains them via children width/height. The
      // _dark filter inverts the monochrome marks so OpenAI's all-black
      // sigil + Anthropic's `#181818` glyph become near-white on the
      // dark canvas. Coloured marks (GoogleCloud, Groq, AWS) get no
      // filter — inverting them would mangle their brand colours.
      css={{ "& > svg": { width: "100%", height: "100%" } }}
      _dark={
        // Pure invert(1) — the monochrome marks are flat black on
        // transparent; rotating hue afterwards would tint the result
        // away from neutral. We want neutral white-ish, so just
        // invert. brightness(0.92) tones the result to off-white so
        // it doesn't hard-burn against the dark surface.
        isMonochrome ? { filter: "invert(1) brightness(0.92)" } : undefined
      }
      aria-hidden="true"
    >
      {icon as React.ReactNode}
    </Box>
  );
}

/**
 * Rich card listing every model a trace touched — provider-icon + full
 * name rows under a count header. A HoverCard (not a Tooltip) so the
 * interactive model rows are keyboard-accessible: it opens on hover AND
 * on trigger focus, and the card content is focusable/tabbable (a tooltip
 * is neither). The chip is the trigger via `asChild`, which preserves the
 * chip's own click-to-filter + ↗ provider link rather than swallowing
 * them. Hover stays forgiving (open/close delays) so the pointer can
 * travel onto the card and click a row. See
 * specs/traces-v2/model-chip-interactive-card.feature
 */
export function ModelsTooltip({
  models,
  children,
}: {
  models: string[];
  children: React.ReactNode;
}) {
  const visible = models.slice(0, EXTRA_MODELS_VISIBLE_CAP);
  const overflow = models.length - visible.length;
  return (
    <HoverCard.Root
      openDelay={150}
      closeDelay={200}
      positioning={{ placement: "top" }}
    >
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            background="bg.panel"
            color="fg"
            borderRadius="xl"
            boxShadow="lg"
            padding={2}
            maxWidth="320px"
          >
            <VStack align="stretch" gap={1}>
              <Text
                textStyle="2xs"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="0.06em"
                paddingX={2}
                paddingTop={1}
              >
                {models.length} models · click to filter
              </Text>
              <VStack align="stretch" gap={0}>
                {visible.map((m) => (
                  <chakra.button
                    key={m}
                    type="button"
                    display="flex"
                    alignItems="center"
                    gap={2}
                    width="full"
                    minWidth={0}
                    paddingX={2}
                    paddingY={1}
                    borderRadius="md"
                    cursor="pointer"
                    textAlign="left"
                    _hover={{ bg: "bg.muted" }}
                    onClick={() =>
                      useFilterStore.getState().toggleFacet("model", m)
                    }
                    aria-label={`Filter by model "${m}"`}
                  >
                    <ProviderIcon model={m} size="comfortable" />
                    <Text textStyle="xs" color="fg" truncate>
                      {m}
                    </Text>
                  </chakra.button>
                ))}
              </VStack>
              {overflow > 0 && (
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  fontStyle="italic"
                  paddingX={2}
                  paddingBottom={1}
                >
                  +{overflow} more
                </Text>
              )}
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

function renderModel(row: TraceListItem, density: Density) {
  if (row.models.length === 0) {
    return (
      <Text textStyle="sm" color="fg.subtle">
        —
      </Text>
    );
  }
  const rawPrimary = row.models[0]!;
  const primary = abbreviateModel(rawPrimary);
  const overflow = row.models.length - 1;
  const compact = density === "compact";
  // "Known" = the provider was recognised, which is the table's proxy
  // for "this model resolves to a cost mapping". Unknown models get an
  // amber chip + a help glyph, and the chip's ↗ points at model settings
  // so the operator can add a regex mapping; known models' ↗ opens the
  // same model-provider settings for that provider.
  const known = inferProvider(rawPrimary) != null;

  // One contained chip: provider (or "unmatched") glyph + primary model
  // name + a quiet "+N" suffix folded inside the same badge for
  // multi-model traces. Clicking it filters by the primary model; the
  // hover ↗ links to model settings; multi-model traces also surface the
  // full list in a hover popover.
  const chip = (
    <FilterChip
      onFilter={() =>
        useFilterStore.getState().toggleFacet("model", rawPrimary)
      }
      filterLabel={`Filter by model "${rawPrimary}"`}
    >
      <Badge
        size="sm"
        variant="surface"
        colorPalette={known ? "gray" : "orange"}
        gap={compact ? 1.5 : 2}
        paddingX={compact ? 2 : 2.5}
        fontWeight="medium"
      >
        {known ? (
          <ProviderIcon
            model={rawPrimary}
            size={compact ? "compact" : "comfortable"}
          />
        ) : (
          <Icon
            boxSize={compact ? "12px" : "14px"}
            color="orange.fg"
            flexShrink={0}
            aria-label="No model-cost match"
          >
            <CircleHelp />
          </Icon>
        )}
        {compact ? (
          <MonoCell truncate whiteSpace={undefined}>
            {primary}
          </MonoCell>
        ) : (
          <Text textStyle="sm" color="fg.muted" truncate>
            {primary}
          </Text>
        )}
        {overflow > 0 && (
          <Text
            as="span"
            textStyle="2xs"
            color="fg.subtle"
            fontWeight="semibold"
            flexShrink={0}
          >
            +{overflow}
          </Text>
        )}
      </Badge>
    </FilterChip>
  );

  if (overflow === 0) return chip;
  return <ModelsTooltip models={row.models}>{chip}</ModelsTooltip>;
}

export const ModelCell = {
  id: "model",
  label: "Model",
  render: ({ row }) => renderModel(row, "compact"),
  renderComfortable: ({ row }) => renderModel(row, "comfortable"),
} as const satisfies CellDef<TraceListItem>;
