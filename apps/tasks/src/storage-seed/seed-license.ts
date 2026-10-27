// gitleaks:allow : the licensing test suite's enterprise fixture, signed by the test key only
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
} from "@langwatch/enterprise-license-signing";
import { ENTERPRISE_TEMPLATE } from "@langwatch/plans";

/** The licensing test suite's enterprise fixture, signed for the test key CI seeds boot with. */
export const TEST_SUITE_ENTERPRISE_LICENSE_KEY =
  "eyJkYXRhIjp7ImxpY2Vuc2VJZCI6ImxpYy0wMDEiLCJ2ZXJzaW9uIjoxLCJvcmdhbml6YXRpb25OYW1lIjoiQWNtZSBDb3JwIiwiZW1haWwiOiJhZG1pbkBhY21lLmNvcnAiLCJpc3N1ZWRBdCI6IjIwMjQtMDEtMDFUMDA6MDA6MDBaIiwiZXhwaXJlc0F0IjoiMjAzMC0xMi0zMVQyMzo1OTo1OVoiLCJwbGFuIjp7InR5cGUiOiJFTlRFUlBSSVNFIiwibmFtZSI6IkVudGVycHJpc2UiLCJtYXhNZW1iZXJzIjoxMDAsIm1heFByb2plY3RzIjo1MDAsIm1heE1lc3NhZ2VzUGVyTW9udGgiOjEwMDAwMDAwLCJldmFsdWF0aW9uc0NyZWRpdCI6MTAwMDAsIm1heFdvcmtmbG93cyI6MTAwMCwibWF4UHJvbXB0cyI6MTAwMCwibWF4RXZhbHVhdG9ycyI6MTAwMCwibWF4U2NlbmFyaW9zIjoxMDAwLCJtYXhBZ2VudHMiOjEwMDAsIm1heEV4cGVyaW1lbnRzIjoxMDAwLCJtYXhPbmxpbmVFdmFsdWF0aW9ucyI6MTAwMCwiY2FuUHVibGlzaCI6dHJ1ZX19LCJzaWduYXR1cmUiOiJhRDlLVkx0V2JOT3pGc3JrOUxHQzdhWEZRdk41MDVBR1VHSWVpcXN5S0tYM1IzK3o1aXIrV01lTS9tQVovOVBOeGRDalUrODVLS3A4TFAweDhIcWl0YnRubVprNVhqQ29uNWQ3S1Q3WFhwOWtsd2tEV0VocnNuL2F5ZWlYcWw0eElzUWZMNG92QitaZEt3TFVQUVFucWFGUVhFU093WEt2akp4QzU0VFp6bUk4THBXbSthYk10Qm50VFNxaFVaamRMdkJJWTlVbHR6LzU2T3pvUmgvdlJuSXhleUdlVkJCK3pWaVQ3LzF6YkpGMG5QZ1ZhVW9GUHI1dFRGYzRvS1VPdXRJSjRyWVJPSkFQNUlUbjZ4OHJLSDBXNi9QSmNVeWlHUE9TL085UXhCVXhGWml0Y3R6UDlwZURGeGhxcm5wbGxUdE1iVER6SVprS3gyMWFadDJMRUE9PSJ9";

/** What the seed stores on the organization, and why. */
export type SeedLicenseChoice =
  | { licenseKey: string; source: "stored" | "signed" | "test-suite" }
  | { licenseKey: null; reason: "no-private-key" | "unpaired-private-key" };

/**
 * Keeps a stored licence that is valid under the boot key (never clobbering a hand-activated
 * one), else signs a fresh one with the private key from secrets, else the CI test-suite
 * fixture when it is valid, else nothing. A private key that does not pair stores nothing.
 */
export function chooseSeedLicense({
  stored,
  publicKey,
  privateKey,
  organization,
}: {
  stored: string | null;
  publicKey: string;
  privateKey: string | undefined;
  organization: { id: string; name: string; email: string };
}): SeedLicenseChoice {
  const cryptography = NodeLicenseCryptographyService.create({ publicKey });
  const isValid = (licenseKey: string) => cryptography.validateLicense({ licenseKey }).valid;

  if (stored && isValid(stored)) return { licenseKey: stored, source: "stored" };

  if (privateKey) {
    const { licenseKey } = LicenseGenerationService.create(cryptography).generate({
      organizationId: organization.id,
      organizationName: organization.name,
      email: organization.email,
      planType: ENTERPRISE_TEMPLATE.type,
      maxMembers: ENTERPRISE_TEMPLATE.maxMembers,
      privateKey,
    });
    return isValid(licenseKey)
      ? { licenseKey, source: "signed" }
      : { licenseKey: null, reason: "unpaired-private-key" };
  }

  if (isValid(TEST_SUITE_ENTERPRISE_LICENSE_KEY)) {
    return { licenseKey: TEST_SUITE_ENTERPRISE_LICENSE_KEY, source: "test-suite" };
  }
  return { licenseKey: null, reason: "no-private-key" };
}
