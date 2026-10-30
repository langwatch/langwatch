/**
 * The analytics app's secrets as boot scopes them, over a fixed environment. The session secret
 * stands in for every deployment's, which keys the query hash.
 */

import { SecretsChain, SecretsResolver } from "@langwatch/secrets";

import { AnalyticsModule } from "../analytics.app.ts";

/** The deployment secret the query hash is keyed from, unless a test names its own. */
export const TEST_SESSION_SECRET = "analytics-test-session-secret";

export function analyticsTestSecrets(
  environment: Readonly<Record<string, string>> = { NEXTAUTH_SECRET: TEST_SESSION_SECRET },
) {
  return SecretsResolver.over(SecretsChain.start({ environment }).withEnv()).scopeTo(
    "analytics",
    Object.values(AnalyticsModule.secrets),
  );
}
