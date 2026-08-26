import {
  deriveFollowUps as derivePackageFollowUps,
  followUpsForResult as followPackageUpsForResult,
  SUGGESTION_LABEL,
} from "@langwatch/langy-web";
import type { FollowUpSuggestion, SettledToolResult } from "@langwatch/langy-web";
import { featureForCliToolName, featuresConsuming } from "~/shared/langy/featureMap";

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
