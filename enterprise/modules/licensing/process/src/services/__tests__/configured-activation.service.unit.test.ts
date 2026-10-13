/** Spec: specs/licensing/configured-license-forms.feature */
import { detectLicenseInputForm } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it, vi } from "vitest";

import {
  type ConfiguredActivationDependencies,
  ConfiguredActivationService,
} from "../configured-activation.service.ts";

const CODE = "LW-A1B2-C3D4-E5F6-G7H8";
const VALID = "valid-signed-license";

class Refusal extends Error {
  constructor(readonly code: string) {
    super(`refused: ${code}`);
  }
}

function build(
  input: Partial<Omit<ConfiguredActivationDependencies, "configured" | "logger">> & {
    value?: string | undefined;
  } = {},
) {
  const { value, ...overrides } = input;
  const logger = { info: vi.fn(), warn: vi.fn() };
  const deps = {
    configured: detectLicenseInputForm("value" in input ? value : CODE),
    connectPermitted: true,
    findOrganizations: vi.fn(async () => [
      { organizationId: "org-old", license: null },
      { organizationId: "org-new", license: null },
    ]),
    redeem: vi.fn(async () => ({ licenseKey: VALID })),
    store: vi.fn(async () => ({ success: true as const })),
    isValidLicense: (license: string) => license === VALID,
    ...overrides,
    logger,
  };
  return { deps, service: ConfiguredActivationService.create(deps) };
}

function loggedMessages(logger: { info: { mock: { calls: unknown[][] } } }): string {
  return logger.info.mock.calls.map((call) => String(call[1])).join("\n");
}

describe("ConfiguredActivationService", () => {
  describe("given the variable holds an activation code and no license is stored", () => {
    /** @scenario "an activation code in the license variable is redeemed at boot" */
    it("redeems it and stores the license on the oldest organization", async () => {
      const { deps, service } = build();

      const outcome = await service.activate();

      expect(outcome).toEqual({ outcome: "activated", organizationId: "org-old" });
      expect(deps.redeem).toHaveBeenCalledWith({ code: "LWA1B2C3D4E5F6G7H8" });
      expect(deps.store).toHaveBeenCalledWith({ organizationId: "org-old", licenseKey: VALID });
      expect(loggedMessages(deps.logger)).toMatch(
        /holds an activation code; redeemed it and stored the license/,
      );
    });
  });

  describe("given an organization already holds a valid license", () => {
    /** @scenario "a boot after the code was redeemed does not redeem it again" */
    it("sends nothing to the connect host", async () => {
      const { deps, service } = build({
        findOrganizations: vi.fn(async () => [{ organizationId: "org-old", license: VALID }]),
      });

      expect(await service.activate()).toEqual({
        outcome: "already_licensed",
        organizationId: "org-old",
      });
      expect(deps.redeem).not.toHaveBeenCalled();
      expect(deps.store).not.toHaveBeenCalled();
    });
  });

  describe("given the stored license is not valid any more", () => {
    it("redeems the configured code", async () => {
      const { service } = build({
        findOrganizations: vi.fn(async () => [
          { organizationId: "org-old", license: "expired-license" },
        ]),
      });

      expect((await service.activate()).outcome).toBe("activated");
    });
  });

  describe("when the connect host refuses the code", () => {
    /** @scenario "a refused redemption is logged with its reason and the app boots" */
    it("logs the refusal code and returns without throwing", async () => {
      const { deps, service } = build({
        redeem: vi.fn(async () => {
          throw new Refusal("activation_code_already_redeemed");
        }),
      });

      expect(await service.activate()).toEqual({
        outcome: "refused",
        code: "activation_code_already_redeemed",
      });
      expect(deps.store).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: "activation_code_already_redeemed" }),
        expect.stringContaining("(activation_code_already_redeemed)"),
      );
    });

    it("names an unreachable host when the error carries no code", async () => {
      const { service } = build({
        redeem: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      });

      expect(await service.activate()).toEqual({
        outcome: "refused",
        code: "connect_unreachable",
      });
    });
  });

  describe("when another replica of this install redeemed the code first", () => {
    /** @scenario "a replica that loses the redemption race reads the stored license" */
    it("reports the install as licensed", async () => {
      const findOrganizations = vi
        .fn<ConfiguredActivationDependencies["findOrganizations"]>()
        .mockResolvedValueOnce([{ organizationId: "org-old", license: null }])
        .mockResolvedValueOnce([{ organizationId: "org-old", license: VALID }]);
      const { deps, service } = build({
        findOrganizations,
        redeem: vi.fn(async () => {
          throw new Refusal("activation_code_already_redeemed");
        }),
      });

      expect(await service.activate()).toEqual({
        outcome: "already_licensed",
        organizationId: "org-old",
      });
      expect(deps.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("given no organization exists yet", () => {
    /** @scenario "an activation code on a fresh install waits for the first organization" */
    it("sends nothing and says it waits for the first organization", async () => {
      const { deps, service } = build({ findOrganizations: vi.fn(async () => []) });

      expect(await service.activate()).toEqual({ outcome: "no_organization" });
      expect(deps.redeem).not.toHaveBeenCalled();
      expect(loggedMessages(deps.logger)).toMatch(
        /redeemed when the first organization is created/,
      );
    });
  });

  describe("given connect is turned off", () => {
    /** @scenario "an activation code with connect turned off is not redeemed" */
    it("does not redeem and points at the signed license key", async () => {
      const { deps, service } = build({ connectPermitted: false });

      expect(await service.activate()).toEqual({ outcome: "connect_disabled" });
      expect(deps.redeem).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("set LANGWATCH_LICENSE_KEY to the signed license key"),
      );
    });
  });

  describe("when the license the code was exchanged for does not validate", () => {
    it("logs it and stores nothing", async () => {
      const { service } = build({
        store: vi.fn(async () => ({ success: false as const, error: "Invalid signature" })),
      });

      expect(await service.activate()).toEqual({
        outcome: "license_rejected",
        error: "Invalid signature",
      });
    });
  });

  describe("when reading the organizations fails", () => {
    it("logs it and returns without throwing", async () => {
      const { deps, service } = build({
        findOrganizations: vi.fn(async () => Promise.reject(new Error("database down"))),
      });

      expect(await service.activate()).toEqual({ outcome: "not_configured" });
      expect(deps.logger.warn).toHaveBeenCalled();
    });
  });

  describe("given the variable holds a signed license key or nothing", () => {
    it("never touches the database or the connect host", async () => {
      for (const value of ["eyJkYXRhIjp7fX0=", "", undefined]) {
        const { deps, service } = build({ value });

        expect(["license_key", "not_configured"]).toContain((await service.activate()).outcome);
        expect(deps.findOrganizations).not.toHaveBeenCalled();
        expect(deps.redeem).not.toHaveBeenCalled();
      }
    });
  });
});
