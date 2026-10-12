/**
 * The PostHog event that carries sign-up attribution.
 *
 * The `signed_up` milestone is tracked when the account row is created, where
 * the server knows nothing about the campaign: first-touch attribution lives
 * in the browser and first reaches the server with the onboarding form. This
 * event is tracked there, against the same user id, so a funnel can filter
 * the sign-up step by campaign.
 *
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import { trackServerEvent } from "~/server/posthog";
import {
  type AttributionField,
  toAttributionProperties,
} from "~/utils/attribution";
import { captureException, toError } from "~/utils/posthogErrorCapture";

/**
 * Tracks organization_created for the user who completed onboarding, with
 * the attribution fields of the sign-up data as event properties and as
 * set-once person properties.
 */
export function trackOrganizationCreated({
  userId,
  organizationId,
  signUpData,
}: {
  userId: string;
  organizationId: string;
  signUpData?: Partial<
    Record<AttributionField, string | null | undefined>
  > | null;
}): void {
  try {
    const attribution = toAttributionProperties(signUpData ?? {});

    trackServerEvent({
      userId,
      event: "organization_created",
      properties: {
        ...attribution,
        organization_id: organizationId,
        $groups: { organization: organizationId },
        // Person properties, so events tracked without attribution (the
        // signed_up milestone, subscription_started) can be filtered by the
        // campaign the person signed up from.
        $set_once: Object.fromEntries(
          Object.entries(attribution).map(([name, value]) => [
            `signup_${name}`,
            value,
          ]),
        ),
      },
    });
  } catch (error) {
    // Building the PostHog client can throw on a bad configuration, and
    // analytics must not fail the onboarding that called it.
    captureException(toError(error), {
      extra: { origin: "trackOrganizationCreated", organizationId },
    });
  }
}
