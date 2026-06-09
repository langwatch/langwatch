import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import type { TraceListItem } from "../../../../../types/trace";
import { abbreviateModel } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

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
function ProviderIcon({
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
        isMonochrome
          ? { filter: "invert(1) brightness(0.92)" }
          : undefined
      }
      aria-hidden="true"
    >
      {icon as React.ReactNode}
    </Box>
  );
}

export function ExtraModelsBadge({
  models,
  size,
}: {
  models: string[];
  size: "xs" | "sm";
}) {
  return (
    <Tooltip
      showArrow
      content={
        <VStack align="start" gap={0.5} paddingY={0.5}>
          {models.map((m) => (
            <Text key={m} textStyle="xs">
              {m}
            </Text>
          ))}
        </VStack>
      }
    >
      <Badge size={size} variant="outline" cursor="help">
        +{models.length}
      </Badge>
    </Tooltip>
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
  const rest = row.models.slice(1);
  // Wrap the icon + label in a light grey badge so the model reads as
  // a contained chip (parallels the Origin column's subtle Badge).
  // Without the surrounding tag the small provider icon felt
  // unprotected and the cell read as floating SVG + text.
  if (density === "compact") {
    return (
      <HStack gap={1.5}>
        <Badge
          size="sm"
          variant="subtle"
          colorPalette="gray"
          gap={1.5}
          paddingX={2}
          fontWeight="medium"
        >
          <ProviderIcon model={rawPrimary} size="compact" />
          <MonoCell truncate whiteSpace={undefined}>
            {primary}
          </MonoCell>
        </Badge>
        {rest.length > 0 && <ExtraModelsBadge models={rest} size="xs" />}
      </HStack>
    );
  }
  return (
    <HStack gap={2}>
      <Badge
        size="sm"
        variant="subtle"
        colorPalette="gray"
        gap={2}
        paddingX={2.5}
        fontWeight="medium"
      >
        <ProviderIcon model={rawPrimary} size="comfortable" />
        <Text textStyle="sm" color="fg.muted" truncate>
          {primary}
        </Text>
      </Badge>
      {rest.length > 0 && <ExtraModelsBadge models={rest} size="sm" />}
    </HStack>
  );
}

export const ModelCell = {
  id: "model",
  label: "Model",
  render: ({ row }) => renderModel(row, "compact"),
  renderComfortable: ({ row }) => renderModel(row, "comfortable"),
} as const satisfies CellDef<TraceListItem>;
