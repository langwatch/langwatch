import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";

/**
 * Identifies a user in Customer.io when they are auto-added to an
 * organization via SSO domain matching.
 *
 * Fires identifyUser, groupUser, and a "joined_via_sso" event —
 * all fire-and-forget so that Customer.io failures never block signup.
 */
export function fireSsoAutoAddNurturingCalls({
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
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

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
        createdAt: new Date().toISOString(),
      },
    })
    .catch(captureException);

  void nurturing
    .groupUser({
      userId,
      groupId: organizationId,
      traits: { name: organizationName },
    })
    .catch(captureException);

  void nurturing
    .trackEvent({
      userId,
      event: "joined_via_sso",
      properties: {
        organization_id: organizationId,
        organization_name: organizationName,
      },
    })
    .catch(captureException);
}
