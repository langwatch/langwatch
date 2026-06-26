import { Box, HStack, Icon, Popover, Text, VStack } from "@chakra-ui/react";
import { CircleAlert, Equal, Trophy } from "lucide-react";
import { useTargetName } from "../hooks/useTargetName";
import type { TargetConfig } from "../types";
import { parseEvaluationResult } from "~/utils/evaluationResults";

type PairwiseCompareCellProps = {
  result: unknown;
  isLoading?: boolean;
  variantATarget?: TargetConfig;
  variantBTarget?: TargetConfig;
};

/**
 * The judge emits per-call markers like
 *   "Call 1 (A in slot A, B in slot B): ..."
 *   "Call 2 (A in slot B, B in slot A): ..."
 * which are useful for debugging bias correction but noisy in the cell
 * preview. Drop the prefix when present; preserve everything else.
 */
function stripBiasPreamble(details: string | undefined): string | undefined {
  if (!details) return details;
  return details
    .replace(/^Call \d+ \([^)]*\):\s*/i, "")
    .trim();
}

/**
 * Map common langevals/litellm error payloads to a short headline +
 * actionable hint. The raw stacktrace (if any) stays available behind
 * a "show details" popover so power users can still dig.
 */
function friendlyError(details: string | undefined): {
  headline: string;
  hint?: string;
  raw?: string;
} {
  const raw = details?.trim();
  if (!raw) return { headline: "Pairwise compare failed" };

  const lower = raw.toLowerCase();
  if (lower.includes("authenticationerror") || lower.includes("api key") || lower.includes("api_key")) {
    return {
      headline: "Missing or invalid model API key",
      hint: "Add the provider key in Settings → AI Gateway, then re-run.",
      raw,
    };
  }
  if (lower.includes("rate limit") || lower.includes("ratelimit") || lower.includes("429")) {
    return {
      headline: "Judge model rate-limited",
      hint: "Slow the run down (lower concurrency) or try a different model.",
      raw,
    };
  }
  if (lower.includes("model not found") || lower.includes("invalid model") || lower.includes("does not exist")) {
    return {
      headline: "Judge model not available",
      hint: "Pick a different model in the evaluator config.",
      raw,
    };
  }
  if (raw === "404 Not Found" || lower.startsWith("404")) {
    return {
      headline: "Judge endpoint not reachable",
      hint: "langevals isn't responding — check the service is running.",
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
  if (lower.includes("candidate_a") || lower.includes("candidate_b") || lower.includes("is required")) {
    return {
      headline: "Variant outputs missing",
      hint: "Run the upstream prompts/agents first so both variants have outputs.",
      raw,
    };
  }

  // Otherwise: use the first line as the headline and keep the rest under "show details".
  const lines = raw.split(/\r?\n/);
  return { headline: lines[0]!, raw: lines.length > 1 ? raw : undefined };
}

function ResolvedVariantName({
  target,
  fallback,
  ...rest
}: {
  target: TargetConfig;
  fallback: string;
} & React.ComponentProps<typeof Text>) {
  const name = useTargetName(target);
  return <Text {...rest}>{name || fallback}</Text>;
}

function VariantName({
  target,
  fallback,
  ...rest
}: {
  target?: TargetConfig;
  fallback: string;
} & React.ComponentProps<typeof Text>) {
  if (!target) {
    return <Text {...rest}>{fallback}</Text>;
  }
  return <ResolvedVariantName target={target} fallback={fallback} {...rest} />;
}

/**
 * Verdict body for the case where both variant targets exist. Lifting the
 * `useTargetName` calls up here lets the label matcher try the resolved
 * handle ("say-hi") in addition to the target id and prompt KSUID.
 */
function ResolvedVerdict({
  label,
  reasoning: rawReasoning,
  variantATarget,
  variantBTarget,
  fallbackA,
  fallbackB,
}: {
  label: string | undefined;
  reasoning: string | undefined;
  variantATarget: TargetConfig;
  variantBTarget: TargetConfig;
  fallbackA: string;
  fallbackB: string;
}) {
  const aHandle = useTargetName(variantATarget);
  const bHandle = useTargetName(variantBTarget);
  const aNameFinal = aHandle || fallbackA;
  const bNameFinal = bHandle || fallbackB;

  let winnerSide: "a" | "b" | "tie" | undefined;
  if (label === "tie") winnerSide = "tie";
  else if (label === "A") winnerSide = "a";
  else if (
    label &&
    (label === variantATarget.id ||
      label === (variantATarget as { promptId?: string }).promptId ||
      label === aHandle)
  )
    winnerSide = "a";
  else if (label === "B") winnerSide = "b";
  else if (
    label &&
    (label === variantBTarget.id ||
      label === (variantBTarget as { promptId?: string }).promptId ||
      label === bHandle)
  )
    winnerSide = "b";

  if (!winnerSide) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        No verdict yet
      </Text>
    );
  }

  const reasoning = stripBiasPreamble(rawReasoning);
  const isTie = winnerSide === "tie";
  const winnerName = winnerSide === "a" ? aNameFinal : bNameFinal;
  const loserName = winnerSide === "a" ? bNameFinal : aNameFinal;

  return (
    <VStack align="stretch" gap={1.5}>
      {isTie ? (
        <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
          <Icon as={Equal} color="fg.muted" boxSize="14px" />
          <Text fontWeight="medium">Tie</Text>
        </HStack>
      ) : (
        <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
          <Icon as={Trophy} color="yellow.fg" boxSize="14px" />
          <Text fontWeight="semibold" color="green.fg">
            {winnerName}
          </Text>
          <Text color="fg.muted">vs</Text>
          <Text color="fg.muted">{loserName}</Text>
        </HStack>
      )}
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

export function PairwiseCompareCell({
  result,
  isLoading = false,
  variantATarget,
  variantBTarget,
}: PairwiseCompareCellProps) {
  const parsed = parseEvaluationResult(result);

  const fallbackA = variantATarget?.id ?? "Candidate A";
  const fallbackB = variantBTarget?.id ?? "Candidate B";

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

  // Defer the rest of the verdict rendering to a child component so we can
  // resolve each variant's display name via the `useTargetName` hook and
  // match the langevals-stored label against that handle too (not just the
  // internal target id / prompt KSUID).
  if (variantATarget && variantBTarget) {
    return (
      <ResolvedVerdict
        label={parsed.label}
        reasoning={parsed.details}
        variantATarget={variantATarget}
        variantBTarget={variantBTarget}
        fallbackA={fallbackA}
        fallbackB={fallbackB}
      />
    );
  }

  // Fallback path when variant targets aren't in the store (e.g. they were
  // removed after the run): match against legacy slot labels only.
  const label = parsed.label;
  let winnerSide: "a" | "b" | "tie" | undefined;
  if (label === "tie") winnerSide = "tie";
  else if (label === "A") winnerSide = "a";
  else if (label === "B") winnerSide = "b";

  if (!winnerSide) {
    return (
      <Text fontSize="13px" color="fg.subtle">
        No verdict yet
      </Text>
    );
  }

  const reasoning = stripBiasPreamble(parsed.details);
  const isTie = winnerSide === "tie";
  const winnerTarget = winnerSide === "a" ? variantATarget : variantBTarget;
  const winnerFallback = winnerSide === "a" ? fallbackA : fallbackB;
  const loserTarget = winnerSide === "a" ? variantBTarget : variantATarget;
  const loserFallback = winnerSide === "a" ? fallbackB : fallbackA;

  return (
    <VStack align="stretch" gap={1.5}>
      {isTie ? (
        <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
          <Icon as={Equal} color="fg.muted" boxSize="14px" />
          <Text fontWeight="medium">Tie</Text>
        </HStack>
      ) : (
        <HStack gap={1.5} fontSize="13px" flexWrap="wrap">
          <Icon as={Trophy} color="yellow.fg" boxSize="14px" />
          <VariantName
            target={winnerTarget}
            fallback={winnerFallback}
            fontWeight="semibold"
            color="green.fg"
          />
          <Text color="fg.muted">vs</Text>
          <VariantName
            target={loserTarget}
            fallback={loserFallback}
            color="fg.muted"
          />
        </HStack>
      )}
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
