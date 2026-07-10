import type { MouseEvent } from "react";
import { Box, HStack, Icon, Popover, Text, VStack } from "@chakra-ui/react";
import { CircleAlert, Equal, Trophy } from "lucide-react";
import { parseEvaluationResult } from "~/utils/evaluationResults";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTargetName } from "../hooks/useTargetName";
import type { TargetConfig } from "../types";

type SelectBestCompareCellProps = {
  result: unknown;
  isLoading?: boolean;
  variantTargets: (TargetConfig | undefined)[];
};

/**
 * Judge emits per-call debug markers like
 *   "Call 1 (candidates in order X, Y, Z): ..."
 * Useful for bias-correction debugging but noisy in the cell preview.
 * Strip when present, preserve everything else.
 */
function stripBiasPreamble(details: string | undefined): string | undefined {
  if (!details) return details;
  return details.replace(/^Call \d+ \([^)]*\):\s*/i, "").trim();
}

function friendlyError(details: string | undefined): {
  headline: string;
  hint?: string;
  raw?: string;
} {
  const raw = details?.trim();
  if (!raw) return { headline: "Select-best compare failed" };

  const lower = raw.toLowerCase();
  if (
    lower.includes("authenticationerror") ||
    lower.includes("api key") ||
    lower.includes("api_key")
  ) {
    return {
      headline: "Missing or invalid model API key",
      hint: "Add the provider key in Settings → AI Gateway, then re-run.",
      raw,
    };
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("ratelimit") ||
    lower.includes("429")
  ) {
    return {
      headline: "Judge model rate-limited",
      hint: "Slow the run down (lower concurrency) or try a different model.",
      raw,
    };
  }
  if (
    lower.includes("model not found") ||
    lower.includes("invalid model") ||
    lower.includes("does not exist")
  ) {
    return {
      headline: "Judge model not available",
      hint: "Pick a different model in the evaluator config.",
      raw,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      headline: "Judge call timed out",
      hint: "Re-run, or try a faster model.",
      raw,
    };
  }
  if (
    lower.includes("waiting on") ||
    lower.includes("no output for this row") ||
    lower.includes("missingvariantoutput")
  ) {
    const dashIdx = raw.indexOf("—");
    if (dashIdx > 0) {
      return {
        headline: raw.slice(0, dashIdx).trim(),
        hint: raw.slice(dashIdx + 1).trim(),
      };
    }
    return { headline: raw };
  }
  if (lower.includes("missing candidate output")) {
    return {
      headline: "One of the candidates is blank",
      hint: "Its prompt returned an empty string — re-run that prompt or check what it's returning.",
      raw,
    };
  }
  const lines = raw.split(/\r?\n/);
  return { headline: lines[0]!, raw: lines.length > 1 ? raw : undefined };
}

/**
 * Renders one variant's name, but only when the judge named it the winner.
 * The cell states the winner alone rather than a "A vs B vs C" chain — with
 * ten candidates the chain buries the one name the reader is looking for.
 *
 * The judge returns the winner's candidate id, which for prompt-typed
 * variants is the prompt HANDLE (e.g. "concise-support-v2"), not the
 * variant's internal target id. Resolving that handle needs `useTargetName`,
 * a hook — so every variant renders this component (keeping hook order
 * stable) and each decides for itself whether it is the winner, rather than
 * the parent resolving names inside a `.map()`.
 */
function WinnerLabel({
  target,
  fallback,
  label,
  onPick,
}: {
  target: TargetConfig | undefined;
  fallback: string;
  label: string | undefined;
  onPick: (targetId: string) => void;
}) {
  const resolved = useTargetName(target ?? (PLACEHOLDER_TARGET as TargetConfig));
  const isWinner = !!target && !!label && matchesLabel(label, target, resolved);
  if (!isWinner) return null;

  return (
    <Text
      as="button"
      fontSize="13px"
      fontWeight="semibold"
      color="green.fg"
      cursor="pointer"
      _hover={{ textDecoration: "underline" }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onPick(target.id);
      }}
      onDoubleClick={(e: MouseEvent) => e.stopPropagation()}
      data-testid="select-best-winner"
    >
      {resolved || fallback}
    </Text>
  );
}

/** A prompt target that resolves to nothing — keeps hook order stable. */
const PLACEHOLDER_TARGET = {
  id: "",
  type: "prompt",
  mappings: {},
} as const;

/**
 * Match the judge's `label` against one variant. The label may be the
 * variant's target id, its prompt KSUID, or its resolved prompt handle.
 */
function matchesLabel(
  label: string,
  target: TargetConfig,
  resolvedName: string,
): boolean {
  return (
    label === target.id ||
    label === (target as { promptId?: string }).promptId ||
    (!!resolvedName && label === resolvedName)
  );
}

export function SelectBestCompareCell({
  result,
  isLoading = false,
  variantTargets,
}: SelectBestCompareCellProps) {
  const parsed = parseEvaluationResult(result);

  const highlightedVariantTargetId = useEvaluationsV3Store(
    (state) => state.ui.highlightedVariantTargetId,
  );
  const setHighlightedVariantTargetId = useEvaluationsV3Store(
    (state) => state.setHighlightedVariantTargetId,
  );
  const toggleHighlight = (targetId: string, outcome: "won" | "lost") => {
    setHighlightedVariantTargetId(
      highlightedVariantTargetId === targetId ? undefined : targetId,
      outcome,
    );
  };

  if (isLoading || parsed.status === "running") {
    return (
      <Text fontSize="13px" color="fg.muted">
        Comparing...
      </Text>
    );
  }

  if (parsed.status === "pending") {
    return (
      <Text fontSize="13px" color="fg.subtle">
        No verdict yet
      </Text>
    );
  }

  if (parsed.status === "error") {
    const { headline, hint, raw } = friendlyError(parsed.details);
    return (
      <Box
        p={2}
        bg="red.subtle"
        color="red.fg"
        borderRadius="md"
        fontSize="13px"
      >
        <HStack gap={1.5} align="start">
          <Icon as={CircleAlert} boxSize="14px" marginTop="2px" />
          <VStack align="stretch" gap={0.5}>
            <Text fontWeight="medium">{headline}</Text>
            {hint ? (
              <Text fontSize="12px" color="fg.muted">
                {hint}
              </Text>
            ) : null}
            {raw ? (
              <Popover.Root>
                <Popover.Trigger asChild>
                  <Box
                    as="button"
                    textAlign="left"
                    color="fg.muted"
                    textDecoration="underline"
                    fontSize="11px"
                  >
                    show details
                  </Box>
                </Popover.Trigger>
                <Popover.Positioner>
                  <Popover.Content maxWidth="460px">
                    <Popover.Arrow />
                    <Popover.Body fontSize="12px" whiteSpace="pre-wrap">
                      {raw}
                    </Popover.Body>
                  </Popover.Content>
                </Popover.Positioner>
              </Popover.Root>
            ) : null}
          </VStack>
        </HStack>
      </Box>
    );
  }

  const label = parsed.label;
  const reasoning = stripBiasPreamble(parsed.details);

  if (label === "tie") {
    return (
      <VStack align="stretch" gap={1.5}>
        <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
          <Icon as={Equal} color="fg.muted" boxSize="14px" />
          <Text fontWeight="medium">Tie</Text>
        </HStack>
        {reasoning ? (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Box
                as="button"
                textAlign="left"
                color="fg.muted"
                _hover={{ color: "fg" }}
              >
                <Text fontSize="12px" lineClamp={2} wordBreak="break-word">
                  {reasoning}
                </Text>
              </Box>
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content maxWidth="460px">
                <Popover.Arrow />
                <Popover.Body fontSize="13px" whiteSpace="pre-wrap">
                  {reasoning}
                </Popover.Body>
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>
        ) : null}
      </VStack>
    );
  }

  if (!label) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        No verdict yet
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={1.5}>
      <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
        <Icon as={Trophy} color="yellow.fg" boxSize="14px" />
        {variantTargets.map((t, i) => (
          <WinnerLabel
            key={t?.id ?? i}
            target={t}
            fallback={t?.id ?? `Candidate ${i + 1}`}
            label={label}
            onPick={(targetId) => toggleHighlight(targetId, "won")}
          />
        ))}
      </HStack>
      {reasoning ? (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Box
              as="button"
              textAlign="left"
              color="fg.muted"
              _hover={{ color: "fg" }}
            >
              <Text fontSize="12px" lineClamp={2} wordBreak="break-word">
                {reasoning}
              </Text>
            </Box>
          </Popover.Trigger>
          <Popover.Positioner>
            <Popover.Content maxWidth="460px">
              <Popover.Arrow />
              <Popover.Body fontSize="13px" whiteSpace="pre-wrap">
                {reasoning}
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Popover.Root>
      ) : null}
    </VStack>
  );
}
