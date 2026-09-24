/**
 * The registry service built on the in-memory ports, with the two key pairs its
 * suites need: LangWatch's own, and a stranger's for a forged license.
 */
import { generateKeyPairSync } from "node:crypto";
import { LicenseRegistryService } from "../../licenseRegistry.service";
import {
  InMemoryConnectManagedKeys,
  InMemoryCustomerOrganizations,
  InMemoryIssuedLicenseRepository,
  RecordingContractBudgets,
  RecordingSeatBilling,
} from "../registryFakes";

export const NOW = new Date("2026-09-19T12:00:00.000Z");
export const NEXT_YEAR = new Date("2027-09-19T12:00:00.000Z");
export const OPERATOR = "user_operator";

function makeKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

export const langwatchKeys = makeKeyPair();
export const strangerKeys = makeKeyPair();

/**
 * `signing: "unconfigured"` rather than `privateKey: undefined`: a destructuring
 * default would replace an explicit undefined with the real key, and the
 * unconfigured case would pass by issuing a license.
 */
export function buildService({
  signing = "configured",
}: {
  signing?: "configured" | "unconfigured";
} = {}) {
  const repository = new InMemoryIssuedLicenseRepository(NOW);
  const organizations = new InMemoryCustomerOrganizations();
  const managedKeys = new InMemoryConnectManagedKeys();
  const contractBudgets = new RecordingContractBudgets();
  const seatBilling = new RecordingSeatBilling();
  const service = new LicenseRegistryService({
    repository,
    organizations,
    managedKeys,
    contractBudgets,
    seatBilling,
    signingKey: () =>
      signing === "configured" ? langwatchKeys.privateKey : undefined,
    publicKey: langwatchKeys.publicKey,
    encrypt: (plain) => `enc(${Buffer.from(plain).toString("base64")})`,
    now: () => NOW,
  });
  return {
    service,
    repository,
    organizations,
    managedKeys,
    contractBudgets,
    seatBilling,
  };
}

export const issueInput = (organizationId: string) => ({
  customer: { organizationId },
  email: "ops@acme.test",
  planType: "ENTERPRISE",
  maxMembers: 50,
  expiresAt: NEXT_YEAR,
  operatorId: OPERATOR,
});
