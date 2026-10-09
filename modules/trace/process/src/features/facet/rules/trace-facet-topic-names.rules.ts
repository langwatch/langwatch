/**
 * Topic names for a facet read under a proof. Topics belong to the project that clustered them, so
 * an aggregate's topic facet holds ids from every member it reads (ADR-175).
 */

import type { Authorization } from "@langwatch/authorization";
import { fenceFor, fenceTenants } from "@langwatch/authorization/tenant-fence";
import type { CategoricalFacetResult } from "@langwatch/trace-contract";

/** Every project the proof reads traces from: its own, then each shared member. */
export function topicProjectsOf({ authorization }: { authorization: Authorization }): string[] {
  return fenceTenants(fenceFor({ authorization, reads: "traces" }));
}

/** Each value takes the first label any project's naming found for it; ids are unique. */
export function mergeTopicLabels({
  base,
  named,
}: {
  base: CategoricalFacetResult;
  named: readonly CategoricalFacetResult[];
}): CategoricalFacetResult {
  return {
    ...base,
    values: base.values.map((value, index) => {
      const label = named.map((result) => result.values[index]?.label).find((l) => l !== void 0);
      return label === void 0 ? value : { ...value, label };
    }),
  };
}
