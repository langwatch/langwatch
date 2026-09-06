import { describe, expect, it } from "vitest";
import {
  assertGatewaySecretsAllOrNone,
  GATEWAY_SECRET_MIN_LENGTH,
  GatewaySecretsConfigurationError,
} from "../gateway-secrets";

/** Long enough to clear the floor without writing a length into the literal. */
const provisioned = (label: string): string => label.padEnd(GATEWAY_SECRET_MIN_LENGTH, "0");

const refusalFor = (source: Record<string, string>): GatewaySecretsConfigurationError => {
  try {
    assertGatewaySecretsAllOrNone(source);
  } catch (error) {
    if (error instanceof GatewaySecretsConfigurationError) return error;
    throw error;
  }
  throw new Error("the configuration was accepted");
};

describe("given the AI Gateway secrets", () => {
  describe("when none of them is set", () => {
    it("accepts the configuration", () => {
      expect(() => assertGatewaySecretsAllOrNone({})).not.toThrow();
    });

    it("reads a blank export as unset rather than as a value", () => {
      expect(() =>
        assertGatewaySecretsAllOrNone({
          LW_GATEWAY_INTERNAL_SECRET: "",
          LW_GATEWAY_JWT_SECRET: "   ",
        }),
      ).not.toThrow();
    });
  });

  describe("when all three are set", () => {
    it("accepts the configuration", () => {
      expect(() =>
        assertGatewaySecretsAllOrNone({
          LW_GATEWAY_INTERNAL_SECRET: provisioned("internal"),
          LW_GATEWAY_JWT_SECRET: provisioned("jwt"),
          LW_VIRTUAL_KEY_PEPPER: provisioned("pepper"),
        }),
      ).not.toThrow();
    });
  });

  describe("when only some of them are set", () => {
    /** @scenario "Setting only some gateway secrets surfaces a self-documenting error" */
    it("names every missing variable and the all-or-none rule", () => {
      const refusal = refusalFor({
        LW_GATEWAY_INTERNAL_SECRET: provisioned("internal"),
      });

      expect(refusal.envs).toEqual(["LW_GATEWAY_JWT_SECRET", "LW_VIRTUAL_KEY_PEPPER"]);
      expect(refusal.message).toContain("LW_GATEWAY_JWT_SECRET");
      expect(refusal.message).toContain("LW_VIRTUAL_KEY_PEPPER");
      expect(refusal.message).toContain("Set all three");
      expect(refusal.message).toContain("or none of them");
    });
  });

  describe("when a value is shorter than the floor", () => {
    /** @scenario "A gateway secret shorter than the minimum length is refused" */
    it("names the variable, the minimum, and the command that generates one", () => {
      const refusal = refusalFor({
        LW_GATEWAY_INTERNAL_SECRET: "too-short",
      });

      expect(refusal.envs).toEqual(["LW_GATEWAY_INTERNAL_SECRET"]);
      expect(refusal.message).toContain("LW_GATEWAY_INTERNAL_SECRET");
      expect(refusal.message).toContain(`${GATEWAY_SECRET_MIN_LENGTH} characters`);
      expect(refusal.message).toContain("openssl rand -hex 32");
    });

    it("reports the length rather than the two variables not reached yet", () => {
      const refusal = refusalFor({ LW_GATEWAY_JWT_SECRET: "short" });

      expect(refusal.message).not.toContain("or none of them");
    });
  });
});
