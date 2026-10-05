import { describe, expect, it, vi } from "vitest";
import {
  activateConfiguredLicense,
  type ConfiguredActivationDependencies,
} from "../configuredActivation";

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/subscriptionHandler", () => ({
  getLicenseHandler: vi.fn(),
}));

const CODE = "LW-A1B2-C3D4-E5F6-G7H8";
const VALID = "valid-signed-license";

class Refusal extends Error {
  constructor(readonly code: string) {
    super(`refused: ${code}`);
  }
}

function build(
  overrides: Partial<ConfiguredActivationDependencies> = {},
): ConfiguredActivationDependencies & {
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  activate: ReturnType<typeof vi.fn>;
  store: ReturnType<typeof vi.fn>;
} {
  return {
    value: CODE,
    connectPermitted: true,
    findOrganizations: vi.fn(async () => [
      { id: "org-old", license: null },
      { id: "org-new", license: null },
    ]),
    instanceId: vi.fn(async () => "instance-1"),
    activate: vi.fn(async () => ({ license: VALID })),
    store: vi.fn(async () => ({ success: true as const })),
    isValidLicense: (license: string) => license === VALID,
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  } as never;
}

function loggedMessages(deps: ReturnType<typeof build>): string[] {
  return [...deps.logger.info.mock.calls, ...deps.logger.warn.mock.calls].map(
    (call) => String(call[1]),
  );
}

describe("activateConfiguredLicense", () => {
  describe("given the variable holds an activation code and no license is stored", () => {
    /** @scenario "an activation code in the license variable is redeemed at boot" */
    it("redeems it with the instance id and stores the license on the oldest organization", async () => {
      const deps = build();

      const outcome = await activateConfiguredLicense(deps);

      expect(outcome).toEqual({
        outcome: "activated",
        organizationId: "org-old",
      });
      expect(deps.activate).toHaveBeenCalledWith({
        code: "LWA1B2C3D4E5F6G7H8",
        instanceId: "instance-1",
      });
      expect(deps.store).toHaveBeenCalledWith({
        organizationId: "org-old",
        license: VALID,
      });
      expect(loggedMessages(deps).join("\n")).toMatch(
        /holds an activation code; redeemed it and stored the license/,
      );
    });
  });

  describe("given an organization already holds a valid license", () => {
    /** @scenario "a boot after the code was redeemed does not redeem it again" */
    it("sends nothing to the connect host", async () => {
      const deps = build({
        findOrganizations: vi.fn(async () => [
          { id: "org-old", license: VALID },
        ]),
      });

      const outcome = await activateConfiguredLicense(deps);

      expect(outcome).toEqual({
        outcome: "already_licensed",
        organizationId: "org-old",
      });
      expect(deps.activate).not.toHaveBeenCalled();
      expect(deps.store).not.toHaveBeenCalled();
    });
  });

  describe("given the stored license is not valid any more", () => {
    it("redeems the configured code", async () => {
      const deps = build({
        findOrganizations: vi.fn(async () => [
          { id: "org-old", license: "expired-license" },
        ]),
      });

      expect((await activateConfiguredLicense(deps)).outcome).toBe("activated");
    });
  });

  describe("when the connect host refuses the code", () => {
    /** @scenario "a refused redemption is logged with its reason and the app boots" */
    it("logs the refusal code and returns without throwing", async () => {
      const deps = build({
        activate: vi.fn(async () => {
          throw new Refusal("activation_code_already_redeemed");
        }),
      });

      const outcome = await activateConfiguredLicense(deps);

      expect(outcome).toEqual({
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
      const deps = build({
        activate: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      });

      expect(await activateConfiguredLicense(deps)).toEqual({
        outcome: "refused",
        code: "connect_unreachable",
      });
    });
  });

  describe("when another replica of this install redeemed the code first", () => {
    /** @scenario "a replica that loses the redemption race reads the stored license" */
    it("reports the install as licensed", async () => {
      const findOrganizations = vi
        .fn()
        .mockResolvedValueOnce([{ id: "org-old", license: null }])
        .mockResolvedValueOnce([{ id: "org-old", license: VALID }]);
      const deps = build({
        findOrganizations,
        activate: vi.fn(async () => {
          throw new Refusal("activation_code_already_redeemed");
        }),
      });

      expect(await activateConfiguredLicense(deps)).toEqual({
        outcome: "already_licensed",
        organizationId: "org-old",
      });
      expect(deps.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("given no organization exists yet", () => {
    /** @scenario "an activation code on a fresh install waits for the first organization" */
    it("sends nothing and says it waits for the first organization", async () => {
      const deps = build({ findOrganizations: vi.fn(async () => []) });

      expect(await activateConfiguredLicense(deps)).toEqual({
        outcome: "no_organization",
      });
      expect(deps.activate).not.toHaveBeenCalled();
      expect(loggedMessages(deps).join("\n")).toMatch(
        /redeemed when the first organization is created/,
      );
    });
  });

  describe("given connect is turned off", () => {
    /** @scenario "an activation code with connect turned off is not redeemed" */
    it("does not redeem and points at the signed license key", async () => {
      const deps = build({ connectPermitted: false });

      expect(await activateConfiguredLicense(deps)).toEqual({
        outcome: "connect_disabled",
      });
      expect(deps.activate).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining(
          "set LANGWATCH_LICENSE_KEY to the signed license key",
        ),
      );
    });
  });

  describe("when the license the code was exchanged for does not validate", () => {
    it("logs it and stores nothing", async () => {
      const deps = build({
        store: vi.fn(async () => ({
          success: false as const,
          error: "Invalid signature",
        })),
      });

      expect(await activateConfiguredLicense(deps)).toEqual({
        outcome: "license_rejected",
        error: "Invalid signature",
      });
    });
  });

  describe("given the variable holds a signed license key or nothing", () => {
    it("never touches the database or the connect host", async () => {
      for (const value of ["eyJkYXRhIjp7fX0=", "", undefined]) {
        const deps = build({ value });

        const outcome = await activateConfiguredLicense(deps);

        expect(["license_key", "not_configured"]).toContain(outcome.outcome);
        expect(deps.findOrganizations).not.toHaveBeenCalled();
        expect(deps.activate).not.toHaveBeenCalled();
      }
    });
  });
});
