import { describe, expect, it } from "vitest";
import { changeTargetsBrokeredPassword } from "../password-change-target";

describe("which password a change rewrites", () => {
  describe("given a deployment that brokers through Auth0", () => {
    /** @scenario "A change targets the password the person actually signs in with" */
    it("rewrites this deployment's own password where the person holds one", () => {
      expect(
        changeTargetsBrokeredPassword({
          provider: "auth0",
          holdsOwnPassword: true,
        }),
      ).toBe(false);
    });

    /** @scenario "A change targets the password the person actually signs in with" */
    it("still goes to the broker for somebody who holds nothing else", () => {
      expect(
        changeTargetsBrokeredPassword({
          provider: "auth0",
          holdsOwnPassword: false,
        }),
      ).toBe(true);
    });
  });

  describe("given a deployment that brokers nothing", () => {
    it("never goes to the broker, whatever the person holds", () => {
      for (const provider of ["email", "google", "okta", "azure-ad"]) {
        expect(
          changeTargetsBrokeredPassword({ provider, holdsOwnPassword: false }),
        ).toBe(false);
        expect(
          changeTargetsBrokeredPassword({ provider, holdsOwnPassword: true }),
        ).toBe(false);
      }
    });
  });

  // The switch is not read here, and that is what makes the change safe to
  // ship turned off: with no local password the answer is the provider's
  // alone, which is exactly what every deployment reached before.
  it("preserves the old answer for everybody holding no password of ours", () => {
    expect(
      changeTargetsBrokeredPassword({
        provider: "auth0",
        holdsOwnPassword: false,
      }),
    ).toBe(true);
    expect(
      changeTargetsBrokeredPassword({
        provider: "email",
        holdsOwnPassword: false,
      }),
    ).toBe(false);
  });
});
