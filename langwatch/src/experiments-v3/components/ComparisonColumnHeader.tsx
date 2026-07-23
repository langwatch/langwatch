import { Box, Button, HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { CircleAlert, Swords } from "lucide-react";
import { useMemo } from "react";

import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useOpenComparisonEditor } from "../hooks/useOpenEvaluatorEditor";
import { useTargetNames } from "../hooks/useTargetName";
import { computeComparisonAggregate } from "../utils/computeAggregates";
import { getEvaluatorMissingMappings } from "../utils/mappingValidation";
import { toComparisonConfig } from "../utils/normalizeComparison";
import { disambiguateNames } from "../utils/variantDisambiguation";
import { ComparisonScoreboard } from "./TargetSection/ComparisonScoreboard";

// Matches the pulse used for the equivalent per-target alert
// (TargetHeader.tsx) — same visual language for "needs your attention".
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

/**
 * Header for a chip-style comparison evaluator's dedicated result column.
 *
 * Swords identifies a comparison; a Trophy is reserved for declaring a winner,
 * which happens per row in `ComparisonCell`. The overall outcome sits on the
 * right, matching where every other column puts its summary.
 *
 * The title opens the config form. Every other evaluator is edited by clicking
 * its chip, but comparisons are filtered out of the chip lists (they grade no
 * single target), so without this the column could be created and never
 * changed.
 */
export function ComparisonColumnHeader({
  evaluatorId,
  name,
}: {
  evaluatorId: string;
  name: string;
}) {
  const evaluator = useEvaluationsV3Store((state) =>
    state.evaluators.find((e) => e.id === evaluatorId),
  );
  const results = useEvaluationsV3Store((state) => state.results);
  const allTargets = useEvaluationsV3Store((state) => state.targets);
  const activeDatasetId = useEvaluationsV3Store(
    (state) => state.activeDatasetId,
  );

  const comparison = evaluator ? toComparisonConfig(evaluator) : undefined;
  const variantIds = comparison?.variants;

  const variantTargets = useMemo(
    () => (variantIds ?? []).map((id) => allTargets.find((t) => t.id === id)),
    [allTargets, variantIds],
  );
  const variantNames = useTargetNames(variantTargets);
  const variantDisplayNames = useMemo(
    () =>
      disambiguateNames(
        variantNames.map(
          (variantName, i) =>
            variantName || variantIds?.[i] || `Variant ${i + 1}`,
        ),
      ),
    [variantNames, variantIds],
  );

  // Chip-style verdicts hang under the first variant's column. Only rows that
  // produced one can be tallied, so that array's length is the row count the
  // aggregate needs — no dataset lookup required.
  const anchorVariantId = variantIds?.[0];
  const rowCount = anchorVariantId
    ? (results.evaluatorResults[anchorVariantId]?.[evaluatorId]?.length ?? 0)
    : 0;

  const aggregate = useMemo(
    () =>
      evaluator ? computeComparisonAggregate(evaluator, results, rowCount) : null,
    [evaluator, results, rowCount],
  );

  const openComparisonEditor = useOpenComparisonEditor();

  // Unlike a per-target chip, this is the ONLY surface that can carry a
  // missing-config cue for a chip-style comparison — it has no column of its
  // own elsewhere, and Run's validation redirect only surfaces the problem
  // after the user already hit Run. targetId is unused by the comparison
  // branch of getEvaluatorMissingMappings (it validates comparison.variants
  // directly), so "" is fine here.
  const hasMissingMappings =
    !!evaluator &&
    !getEvaluatorMissingMappings(evaluator, activeDatasetId, "").isValid;

  return (
    <HStack gap={1.5} width="full">
      <Button
        variant="ghost"
        size="xs"
        paddingX={1}
        marginLeft={-1}
        height="auto"
        fontWeight="medium"
        disabled={!evaluator}
        onClick={() => evaluator && openComparisonEditor(evaluator)}
        data-testid="comparison-column-header-edit"
      >
        <Icon as={Swords} color="fg.muted" boxSize="14px" />
        <Text fontSize="13px" fontWeight="medium">
          {name}
        </Text>
      </Button>
      {hasMissingMappings && (
        <Tooltip
          content="Needs configuration — click to pick variants"
          positioning={{ placement: "top" }}
          openDelay={0}
          showArrow
        >
          <Box
            css={{ animation: `${pulseAnimation} 2s ease-in-out infinite` }}
            flexShrink={0}
            data-testid="comparison-missing-mapping-alert"
            onClick={() => evaluator && openComparisonEditor(evaluator)}
            cursor="pointer"
            _hover={{ transform: "scale(1.2)" }}
            transition="transform 0.15s"
          >
            <Icon as={CircleAlert} color="yellow.fg" boxSize={4} />
          </Box>
        </Tooltip>
      )}
      <Spacer />
      {aggregate && (
        <ComparisonScoreboard
          aggregate={aggregate}
          variantTargets={variantTargets}
          variantNames={variantNames}
          variantDisplayNames={variantDisplayNames}
        />
      )}
    </HStack>
  );
}
