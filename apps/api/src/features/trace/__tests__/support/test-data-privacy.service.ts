import type { DataPrivacyApi, ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

/**
 * The one privacy answer a trace read asks for. Every other operation refuses by
 * name: a suite that drives the read stack writes no rule.
 */
export function testDataPrivacyApi(policy: ResolvedDataPrivacy): DataPrivacyApi {
  return createApiFixture<DataPrivacyApi>(
    {
      getResolvedForProject: async () => policy,
      listOrganizationRules: async () => [],
    },
    "trace data privacy",
  );
}
