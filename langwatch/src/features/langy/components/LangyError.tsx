import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { LangyCard } from "~/features/asaplangy";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import type {
  LangyErrorPresentation,
  LangySerializedReason,
} from "../logic/langyErrorExplainer";

// The retry sits behind the same restrained warm hairline the accent cards use
// (asaplangy CARD.accentBorder) — the accent is present on the action, calm
// everywhere else.
const CALM_ACCENT_BORDER =
  "color-mix(in srgb, var(--chakra-colors-orange-solid) 30%, var(--chakra-colors-border-emphasized))";

/**
 * Renders a Langy domain error according to its presentation `render` mode
 * (ADR-045):
 *   - `suppress` → renders nothing here; the caller shows the connect card /
 *     empty state / model setup instead of an error. This component returns
 *     null so a not-connected/no-data condition never reads as a failure.
 *   - `inline`   → a compact, low-chrome one-liner beside the failed message.
 *   - `card`     → a calm, actionable card in Langy's own skin.
 *
 * These are NOT loud alert boxes. An error still reads in the interface's voice:
 * it states what happened and offers the way forward (the retry) as a clear
 * action, with the trouble carried by a calm rust tone and the accent spent only
 * on the action itself — the langy card material (asaplangy CARD_TAXONOMY), not a
 * red-bordered warning. Copy comes pre-shaped by the explainer; the retry
 * callback wiring is unchanged.
 */
export function LangyError({
  presentation,
  onAction,
}: {
  presentation: LangyErrorPresentation;
  onAction?: (
    kind: NonNullable<LangyErrorPresentation["action"]>["kind"],
  ) => void;
}) {
  if (presentation.render === "suppress") return null;

  const action = presentation.action ? (
    <Button
      size="xs"
      variant="outline"
      borderColor={CALM_ACCENT_BORDER}
      color="orange.fg"
      fontWeight="560"
      onClick={() => onAction?.(presentation.action!.kind)}
    >
      <RotateCcw size={12} aria-hidden="true" />
      {presentation.action.label}
    </Button>
  ) : null;

  if (presentation.render === "inline") {
    // The quietest error: an activity-weight line beside the message, rust dot,
    // the retry as a plain amber link. No box, no alarm.
    return (
      <HStack gap={1.5} alignSelf="flex-start" color="fg.muted" textStyle="xs">
        <Box color="red.fg" display="flex" flexShrink={0}>
          <AlertCircle size={13} aria-hidden="true" />
        </Box>
        <Text>{presentation.title}</Text>
        {presentation.action ? (
          <Button
            variant="plain"
            size="xs"
            height="auto"
            padding={0}
            color="orange.fg"
            fontWeight="560"
            onClick={() => onAction?.(presentation.action!.kind)}
          >
            {presentation.action.label}
          </Button>
        ) : null}
      </HStack>
    );
  }

  // `change`-weight: a calm receipt that something didn't complete. Rust icon +
  // title state what happened; the description says how to fix it; the accent is
  // spent only on the retry.
  return (
    <LangyCard
      intent="change"
      role="alert"
      actions={action}
      title={
        <HStack gap={2} align="start">
          <Box color="red.fg" display="flex" flexShrink={0} marginTop="1px">
            <AlertCircle size={15} aria-hidden="true" />
          </Box>
          <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
            <Text textStyle="sm" fontWeight="640" color="fg" lineHeight="1.3">
              {presentation.title}
            </Text>
            {presentation.description ? (
              <Text textStyle="xs" color="fg.muted" lineHeight="1.45">
                {presentation.description}
              </Text>
            ) : null}
          </VStack>
        </HStack>
      }
    >
      <ErrorDetails
        meta={presentation.meta}
        reasons={presentation.reasons}
        traceId={presentation.traceId}
      />
    </LangyCard>
  );
}

/**
 * The debug drawer under an error: the domain `meta` and the `reasons` chain.
 *
 * ── DEVELOPER MODE ONLY ────────────────────────────────────────────────────
 * This used to render for everyone, which is how a timeout card — whose copy is
 * otherwise good ("That took too long… ask for a narrower slice") — ended up
 * with `timeoutMs: 120000` printed underneath it. That is our plumbing, in the
 * user's face, and `dev/docs/best_practices/copywriting.md` forbids exactly it:
 * copy says what happened to the customer, never how we implemented it. Nobody
 * outside this repo knows what a `timeoutMs` is, and nobody should have to.
 *
 * The information is genuinely useful — to US. So it lives where our tools live:
 * behind developer mode, with the rest of the machinery.
 *
 * The TRACE ID is the exception and stays. It is not an internal detail; it is
 * the one thing a user can hand to support, and the copy explicitly asks them to
 * ("share the id below with support").
 */
function ErrorDetails({
  meta,
  reasons,
  traceId,
}: {
  meta?: Record<string, unknown>;
  reasons?: LangySerializedReason[];
  traceId?: string;
}) {
  const [devMode] = useLangyDevMode();
  const hasMeta = devMode && meta && Object.keys(meta).length > 0;
  const hasReasons = devMode && reasons && reasons.length > 0;
  if (!traceId && !hasMeta && !hasReasons) return null;

  return (
    <VStack
      align="stretch"
      gap={1}
      paddingTop={1}
      borderTopWidth="1px"
      borderTopStyle="solid"
      borderTopColor="border.muted"
    >
      {traceId ? (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          id: {traceId}
        </Text>
      ) : null}
      {hasMeta ? (
        <VStack align="stretch" gap={0}>
          {Object.entries(meta!).map(([key, val]) => (
            <Text key={key} textStyle="2xs" color="fg.subtle" fontFamily="mono">
              {key}: {formatMetaValue(val)}
            </Text>
          ))}
        </VStack>
      ) : null}
      {hasReasons ? (
        <VStack align="stretch" gap={0}>
          <Text textStyle="2xs" color="fg.subtle" fontWeight="600">
            Reasons
          </Text>
          {flattenReasons(reasons!).map((kind, index) => (
            <Text
              key={`${kind}-${index}`}
              textStyle="2xs"
              color="fg.subtle"
              fontFamily="mono"
            >
              • {kind}
            </Text>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

function formatMetaValue(val: unknown): string {
  if (val === null || val === undefined) return String(val);
  if (typeof val === "object") {
    try {
      return JSON.stringify(val);
    } catch {
      return "[object]";
    }
  }
  return String(val);
}

/** Flatten the recursive reason chain into an indented kind list. */
function flattenReasons(reasons: LangySerializedReason[], depth = 0): string[] {
  const out: string[] = [];
  for (const reason of reasons) {
    out.push(`${"  ".repeat(depth)}${reason.kind}`);
    if (reason.reasons?.length) {
      out.push(...flattenReasons(reason.reasons, depth + 1));
    }
  }
  return out;
}
