import {
  deriveFollowUps as derivePackageFollowUps,
  followUpsForResult as followPackageUpsForResult,
  SUGGESTION_LABEL,
} from "../../../../index";
import type { FollowUpSuggestion, SettledToolResult } from "../../../../index";
import { featureForCliToolName, featuresConsuming } from "../../../../shared/langy/feature-map";

const featureMap = { featureForCliToolName, featuresConsuming };

export const followUpsForResult = (result: SettledToolResult): FollowUpSuggestion[] =>
  followPackageUpsForResult(result, featureMap);

export const deriveFollowUps = ({
  results,
}: {
  results: SettledToolResult[];
}): FollowUpSuggestion[] => derivePackageFollowUps({ results, featureMap });

export { SUGGESTION_LABEL };
export type { FollowUpSuggestion, SettledToolResult };
