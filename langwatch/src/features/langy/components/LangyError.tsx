import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import { useLangyDevMode } from "../hooks/useLangyDevMode";
import type {
  LangyErrorPresentation,
  LangySerializedReason,
} from "../logic/langyErrorExplainer";

/**
 * Renders a Langy domain error according to its presentation `render` mode
 * (ADR-045):
 *   - `suppress` → renders nothing here; the caller shows the connect card /
 *     empty state / model setup instead of an error. This component returns
 *     null so a not-connected/no-data condition never reads as a failure.
 *   - `inline`   → a compact, low-chrome one-liner beside the failed message.
 *   - `card`     → a titled, actionable block.
 *
 * Uses semantic tokens (orange accent for the retry action, `fg`/`border`),
 * never hardcoded hex.
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

  if (presentation.render === "inline") {
    return (
      <HStack
        gap={1.5}
        alignSelf="flex-start"
        color="fg.muted"
        textStyle="xs"
        role="status"
      >
        <AlertTriangle size={13} />
        <Text>{presentation.title}</Text>
        {presentation.action ? (
          <Button
            variant="plain"
            size="xs"
            height="auto"
            padding={0}
            color="orange.solid"
            fontWeight="500"
            onClick={() => onAction?.(presentation.action!.kind)}
          >
            {presentation.action.label}
          </Button>
        ) : null}
      </HStack>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={2}
      padding={3}
      borderRadius="lg"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.emphasized"
      background="bg.subtle"
      role="alert"
    >
      <HStack gap={2} align="start">
        <Box color="fg.muted" marginTop="1px">
          <AlertTriangle size={15} />
        </Box>
        <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
          <Text textStyle="sm" fontWeight="600" color="fg">
            {presentation.title}
          </Text>
          {presentation.description ? (
            <Text textStyle="xs" color="fg.muted" lineHeight="1.45">
              {presentation.description}
            </Text>
          ) : null}
        </VStack>
      </HStack>
      <ErrorDetails
        meta={presentation.meta}
        reasons={presentation.reasons}
        traceId={presentation.traceId}
      />
      {presentation.action ? (
        <HStack justify="flex-end">
          <Button
            size="xs"
            variant="outline"
            borderColor="orange.solid"
            color="orange.solid"
            onClick={() => onAction?.(presentation.action!.kind)}
          >
            {presentation.action.label}
          </Button>
        </HStack>
      ) : null}
    </VStack>
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
