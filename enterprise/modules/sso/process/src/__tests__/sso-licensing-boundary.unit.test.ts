/**
 * @vitest-environment node
 * Single sign-on asks the shared Licensing contract and keeps no licensing of its own.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type LicensingApi,
  type PlatformLicenseAccess,
} from "@langwatch/enterprise-licensing-contract";
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import { isNamedProviderMounted } from "@langwatch/enterprise-sso-contract/sign-in-providers";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { SsoGateService, SsoProviderMountInspector } from "../services/sso-gate.service.ts";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionFiles(path);
    return [path.slice(sourceRoot.length + 1)];
  });
}

class MountedInspector extends SsoProviderMountInspector {
  isMounted(configuration: SsoConfiguration): boolean {
    return isNamedProviderMounted(configuration);
  }
}

describe("single sign-on and licensing", () => {
  describe("given the gate is composed with the shared Licensing contract", () => {
    /** @scenario "SSO does not reimplement licensing" */
    it("decides through that contract and owns no license verifier or license repository", async () => {
      const access: PlatformLicenseAccess = { allowed: true, inspections: [] };
      const inspectPlatformAccess = vi.fn(async () => access);
      const licensing = createApiFixture<LicensingApi>({
        inspectPlatformAccess,
        licenseRevision: async () => 0,
      });
      const gate = SsoGateService.create({
        configuration: {
          isSaas: false,
          provider: "auth0",
          baseUrl: "https://acme.test",
          auth0ClientId: "client",
          auth0ClientSecret: "secret",
          auth0Issuer: "https://acme.auth0.com",
        },
        licensing,
        logger: { info: vi.fn(), warn: vi.fn() },
        providerMountInspector: new MountedInspector(),
        now: () => 1_000_000,
      });

      await expect(gate.platformAllowed()).resolves.toBe(true);
      expect(inspectPlatformAccess).toHaveBeenCalledOnce();

      const files = productionFiles(sourceRoot);
      expect(files.filter((file) => /licen[cs]e|verifier/i.test(file))).toEqual([]);
      expect(files.filter((file) => file.startsWith("repositories/"))).toEqual([]);
    });
  });
});
