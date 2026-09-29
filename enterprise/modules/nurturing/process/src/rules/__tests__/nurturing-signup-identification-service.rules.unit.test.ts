/**
 * What a new sign-up tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import { fireSignup } from "../nurturing-signup-identification-service.rules.ts";

const SIGNUP = {
  userId: "user-1",
  email: "jane@example.com",
  name: "Jane Doe",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};

describe("fireSignup", () => {
  describe("given a person completing onboarding with their role and company size", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "New signup identifies user with traits in Customer.io" */
      it("decides to identify them with email, name, role and company size", () => {
        const calls = fireSignup({
          ...SIGNUP,
          signUpData: { yourRole: "engineer", companySize: "11-50" },
        });

        expect(calls[0]).toMatchObject({
          type: "identify",
          userId: "user-1",
          traits: {
            email: "jane@example.com",
            name: "Jane Doe",
            role: "engineer",
            company_size: "11-50",
            has_traces: false,
            has_evaluations: false,
          },
        });
      });

      /** @scenario "New signup associates user with organization via group call" */
      it("decides to associate them with their organization by name", () => {
        const calls = fireSignup({ ...SIGNUP, signUpData: { companySize: "11-50" } });

        expect(calls[1]).toMatchObject({
          type: "group",
          userId: "user-1",
          groupId: "org-1",
          traits: { name: "Acme Corp", company_size: "11-50", plan: "free" },
        });
      });

      /** @scenario "New signup tracks signed_up event" */
      it("decides to track a signed_up event carrying the sign-up answers", () => {
        const calls = fireSignup({
          ...SIGNUP,
          signUpData: { yourRole: "engineer", companySize: "11-50" },
        });

        expect(calls[2]).toMatchObject({
          type: "track",
          userId: "user-1",
          event: "signed_up",
          properties: { yourRole: "engineer", companySize: "11-50" },
        });
      });

      /** @scenario "Signup defaults include has_prompts and has_simulations as false" */
      it("decides to send every milestone trait as not yet reached", () => {
        const calls = fireSignup(SIGNUP);

        expect(calls[0]).toMatchObject({
          traits: {
            has_prompts: false,
            has_simulations: false,
            has_traces: false,
            has_evaluations: false,
          },
        });
      });
    });
  });

  describe("given a sign-up carrying optional marketing answers", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Signup identification includes optional marketing fields when present" */
      it("includes the campaign and how they heard about us", () => {
        const calls = fireSignup({
          ...SIGNUP,
          signUpData: { utmCampaign: "launch-week", howDidYouHearAboutUs: "twitter" },
        });

        expect(calls[0]).toMatchObject({
          traits: { utm_campaign: "launch-week", how_heard: "twitter" },
        });
      });
    });
  });

  describe("given a sign-up carrying a first-touch lead source", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Signup with ref in URL sends lead_source trait and event property to Customer.io" */
      it("sends lead_source as a trait and leadSource as an event property", () => {
        const calls = fireSignup({ ...SIGNUP, signUpData: { leadSource: "website" } });

        expect(calls[0]).toMatchObject({ traits: { lead_source: "website" } });
        expect(calls[2]).toMatchObject({
          event: "signed_up",
          properties: { leadSource: "website" },
        });
      });

      /** @scenario "Signup forwards utm tuple to Customer.io" */
      it("forwards the whole utm tuple", () => {
        const calls = fireSignup({
          ...SIGNUP,
          signUpData: {
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "launch-week",
            utmTerm: "llm observability",
            utmContent: "variant-a",
          },
        });

        expect(calls[0]).toMatchObject({
          traits: {
            utm_source: "google",
            utm_medium: "cpc",
            utm_campaign: "launch-week",
            utm_term: "llm observability",
            utm_content: "variant-a",
          },
        });
      });
    });
  });

  describe("given a sign-up with no attribution at all", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Signup without attribution omits those fields from Customer.io traits" */
      it("omits the attribution keys rather than sending them empty", () => {
        const calls = fireSignup(SIGNUP);

        const { traits } = calls[0] as { traits: Record<string, unknown> };
        for (const key of [
          "lead_source",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_term",
          "utm_content",
          "referrer",
        ]) {
          expect(traits).not.toHaveProperty(key);
        }
      });
    });
  });
});
