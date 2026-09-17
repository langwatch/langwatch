import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Identifies a user in Customer.io when they are auto-added to an organization via SSO
 * domain matching.
 */
export function fireSsoAutoAdd({
  userId,
  email,
  name,
  organizationId,
  organizationName,
}: {
  userId: string;
  email: string;
  name: string | null | undefined;
  organizationId: string;
  organizationName: string;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({
      userId,
      traits: {
        email,
        ...(name ? { name } : {}),
        has_traces: false,
        has_evaluations: false,
        has_prompts: false,
        has_simulations: false,
        has_subscription: false,
        createdAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
      },
    })
    .catch(reportFailure);

  void nurturing
    .groupUser({
      userId,
      groupId: organizationId,
      traits: { name: organizationName },
    })
    .catch(reportFailure);

  void nurturing
    .trackEvent({
      userId,
      event: "joined_via_sso",
      properties: {
        organization_id: organizationId,
        organization_name: organizationName,
      },
    })
    .catch(reportFailure);
}
