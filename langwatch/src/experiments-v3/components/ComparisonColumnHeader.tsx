import { HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import { Swords } from "lucide-react";
import { useMemo } from "react";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTargetNames } from "../hooks/useTargetName";
import { computeComparisonAggregate } from "../utils/computeAggregates";
import { toComparisonConfig } from "../utils/normalizeComparison";
import { disambiguateNames } from "../utils/variantDisambiguation";
import { ComparisonScoreboard } from "./TargetSection/ComparisonScoreboard";

/**
 * Header for a chip-style comparison evaluator's dedicated result column.
 *
 * Swords identifies a comparison; a Trophy is reserved for declaring a winner,
 * which happens per row in `ComparisonCell`. The overall outcome sits on the
 * right, matching where every other column puts its summary.
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

  return (
    <HStack gap={1.5} width="full">
      <Icon as={Swords} color="fg.muted" boxSize="14px" />
      <Text fontSize="13px" fontWeight="medium">
        {name}
      </Text>
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
