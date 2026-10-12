/**
 * @vitest-environment node
 *
 * What organization creation reports to PostHog: the attribution the
 * onboarding form delivered, as event properties and as person properties.
 *
 * @see specs/analytics/posthog-campaign-conversion.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { trackOrganizationCreated } from "../signup-attribution.analytics";

const { trackServerEvent, captureException } = vi.hoisted(() => ({
  trackServerEvent: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException,
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

describe("trackOrganizationCreated()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when the sign-up data carries attribution", () => {
    /** @scenario "Organization creation tracks sign-up attribution in PostHog" */
    it("tracks organization_created with the attribution and sets it once on the person", () => {
      trackOrganizationCreated({
        userId: "user_1",
        organizationId: "org_1",
        signUpData: {
          leadSource: "website",
          utmSource: "newsletter",
          utmMedium: "email",
          utmCampaign: "weekly",
          utmTerm: null,
          utmContent: "",
          referrer: "https://example.com/",
        },
      });

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "user_1",
        event: "organization_created",
        properties: {
          lead_source: "website",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "weekly",
          referrer: "https://example.com/",
          organization_id: "org_1",
          $groups: { organization: "org_1" },
          $set_once: {
            signup_lead_source: "website",
            signup_utm_source: "newsletter",
            signup_utm_medium: "email",
            signup_utm_campaign: "weekly",
            signup_referrer: "https://example.com/",
          },
        },
      });
    });

    it("leaves every other sign-up field out of the event", () => {
      trackOrganizationCreated({
        userId: "user_1",
        organizationId: "org_1",
        signUpData: {
          utmSource: "newsletter",
          yourRole: "Engineer",
          companySize: "1-10",
        } as Parameters<typeof trackOrganizationCreated>[0]["signUpData"],
      });

      const { properties } = trackServerEvent.mock.calls[0]![0];
      expect(Object.keys(properties).sort()).toEqual([
        "$groups",
        "$set_once",
        "organization_id",
        "utm_source",
      ]);
    });
  });

  describe("when there is no attribution", () => {
    /** @scenario "Organization creation without attribution tracks no attribution properties" */
    it("tracks organization_created with only the organization id", () => {
      trackOrganizationCreated({
        userId: "user_1",
        organizationId: "org_1",
        signUpData: null,
      });

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "user_1",
        event: "organization_created",
        properties: {
          organization_id: "org_1",
          $groups: { organization: "org_1" },
          $set_once: {},
        },
      });
    });
  });

  describe("when tracking throws", () => {
    /** @scenario "A failure while tracking organization_created does not fail onboarding" */
    it("captures the error and does not throw", () => {
      const error = new Error("bad PostHog configuration");
      trackServerEvent.mockImplementationOnce(() => {
        throw error;
      });

      expect(() =>
        trackOrganizationCreated({
          userId: "user_1",
          organizationId: "org_1",
          signUpData: null,
        }),
      ).not.toThrow();

      expect(captureException).toHaveBeenCalledWith(error, {
        extra: { origin: "trackOrganizationCreated", organizationId: "org_1" },
      });
    });
  });
});
