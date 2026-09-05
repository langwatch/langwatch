/**
 * What a new sign-up tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NurturingSignupIdentificationService } from "../nurturing-signup-identification.service";
import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "./support/nurturing-harness";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const SIGNUP = {
  userId: "user-1",
  email: "jane@example.com",
  name: "Jane Doe",
  organizationId: "org-1",
  organizationName: "Acme Corp",
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => registerNoNurturingSink());

describe("NurturingSignupIdentificationService.fireSignup", () => {
  describe("given a person completing onboarding with their role and company size", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "New signup identifies user with traits in Customer.io" */
      it("identifies them with email, name, role and company size", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: { yourRole: "engineer", companySize: "11-50" },
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
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
      it("associates them with their organization by name", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: { companySize: "11-50" },
        });
        await settle();

        expect(sink.sentTo("/group")[0]).toMatchObject({
          userId: "user-1",
          groupId: "org-1",
          traits: { name: "Acme Corp", company_size: "11-50", plan: "free" },
        });
      });

      /** @scenario "New signup tracks signed_up event" */
      it("tracks a signed_up event carrying the sign-up answers", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: { yourRole: "engineer", companySize: "11-50" },
        });
        await settle();

        expect(sink.sentTo("/track")[0]).toMatchObject({
          userId: "user-1",
          event: "signed_up",
          properties: { yourRole: "engineer", companySize: "11-50" },
        });
      });

      /** @scenario "Signup defaults include has_prompts and has_simulations as false" */
      it("sends every milestone trait as not yet reached", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup(SIGNUP);
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
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
      it("includes the campaign and how they heard about us", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: { utmCampaign: "launch-week", howDidYouHearAboutUs: "twitter" },
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          traits: { utm_campaign: "launch-week", how_heard: "twitter" },
        });
      });
    });
  });

  describe("given a sign-up carrying a first-touch lead source", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Signup with ref in URL sends lead_source trait and event property to Customer.io" */
      it("sends lead_source as a trait and leadSource as an event property", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: { leadSource: "website" },
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
          traits: { lead_source: "website" },
        });
        expect(sink.sentTo("/track")[0]).toMatchObject({
          event: "signed_up",
          properties: { leadSource: "website" },
        });
      });

      /** @scenario "Signup forwards utm tuple to Customer.io" */
      it("forwards the whole utm tuple", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup({
          ...SIGNUP,
          signUpData: {
            utmSource: "google",
            utmMedium: "cpc",
            utmCampaign: "launch-week",
            utmTerm: "llm observability",
            utmContent: "variant-a",
          },
        });
        await settle();

        expect(sink.sentTo("/identify")[0]).toMatchObject({
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
      it("omits the attribution keys rather than sending them empty", async () => {
        const sink = registerNurturingSink();

        NurturingSignupIdentificationService.fireSignup(SIGNUP);
        await settle();

        const { traits } = sink.sentTo("/identify")[0] as { traits: Record<string, unknown> };
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

  describe("given Customer.io is unavailable", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Customer.io failure during signup does not block onboarding" */
      it("returns normally and reports the failure for observability", async () => {
        const sink = registerNurturingSink({ failing: true });

        expect(() => NurturingSignupIdentificationService.fireSignup(SIGNUP)).not.toThrow();
        await settle();

        expect(sink.errorReporter.capture).toHaveBeenCalled();
      });
    });
  });

  describe("given a deployment that configured no Customer.io key", () => {
    describe("when the onboarding flow completes", () => {
      /** @scenario "Signup with no Customer.io key configured completes without errors" */
      it("makes no request at all and raises nothing", async () => {
        const sink = registerNurturingSink();
        registerNoNurturingSink();

        expect(() => NurturingSignupIdentificationService.fireSignup(SIGNUP)).not.toThrow();
        await settle();

        expect(sink.fetchFn).not.toHaveBeenCalled();
      });
    });
  });
});
