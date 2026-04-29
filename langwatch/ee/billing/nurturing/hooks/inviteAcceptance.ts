import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";

/**
 * Identifies a user in Customer.io when they accept an invite and join
 * an existing organization.
 *
 * Fires identifyUser, groupUser, and a "joined_via_invite" event —
 * all fire-and-forget so that Customer.io failures never block the invite flow.
 */
export function fireInviteAcceptedNurturingCalls({
  userId,
  email,
  name,
  organizationId,
  organizationName,
}: {
  userId: string;
  email: string | null | undefined;
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
        ...(email ? { email } : {}),
        ...(name ? { name } : {}),
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
      event: "joined_via_invite",
      properties: {
        organization_id: organizationId,
        organization_name: organizationName,
      },
    })
    .catch(captureException);
}
