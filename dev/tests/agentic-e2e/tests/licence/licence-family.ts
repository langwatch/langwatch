/**
 * The licence family for specs/e2e/licence-journeys.feature: TEST values minted from the
 * committed TEST keypair, trusted only where LANGWATCH_LICENSE_PUBLIC_KEY names its public key.
 */
import { createSign } from "node:crypto";

import {
  TEST_PRIVATE_KEY,
  WRONG_PRIVATE_KEY,
} from "@langwatch/enterprise-licensing-process/testing";

import { E2E_ENTERPRISE_LICENSE_KEY } from "../license.fixture";
import { getOrgAndTeamIds } from "../members/steps";
import { expect, type Page } from "../test.ts";

type LicencePlan = { type: string; name: string; maxMembers: number } & Record<string, unknown>;
type LicenceData = {
  licenseId: string;
  expiresAt: string;
  organizationName: string;
  plan: LicencePlan;
} & Record<string, unknown>;
type SignedLicence = { data: LicenceData; signature: string };

function decode({ key }: { key: string }): SignedLicence {
  return JSON.parse(Buffer.from(key, "base64").toString("utf-8"));
}

function encode({ licence }: { licence: SignedLicence }): string {
  return Buffer.from(JSON.stringify(licence), "utf-8").toString("base64");
}

/** Signs the bytes the stack verifies: JSON.stringify(data), RSA-SHA256, base64. */
function mint({ data, privateKey }: { data: LicenceData; privateKey: string }): string {
  const signature = createSign("SHA256").update(JSON.stringify(data)).sign(privateKey, "base64");
  return encode({ licence: { data, signature } });
}

/** Spreads keep the signed field order, which the stack re-serialises to verify. */
const ENTERPRISE = decode({ key: E2E_ENTERPRISE_LICENSE_KEY });
const withData = (patch: Partial<LicenceData>): LicenceData => ({ ...ENTERPRISE.data, ...patch });
const withPlan = (patch: Partial<LicencePlan>): LicencePlan => ({
  ...ENTERPRISE.data.plan,
  ...patch,
});

export const LICENCE_FAMILY = {
  enterprise: E2E_ENTERPRISE_LICENSE_KEY,
  oneSeat: mint({
    data: withData({ licenseId: "lic-e2e-one-seat", plan: withPlan({ maxMembers: 1 }) }),
    privateKey: TEST_PRIVATE_KEY,
  }),
  expired: mint({
    data: withData({ licenseId: "lic-e2e-expired", expiresAt: "2025-01-01T00:00:00Z" }),
    privateKey: TEST_PRIVATE_KEY,
  }),
  otherKey: mint({
    data: withData({ licenseId: "lic-e2e-other-key" }),
    privateKey: WRONG_PRIVATE_KEY,
  }),
  tamperedByte: encode({
    licence: { ...ENTERPRISE, data: withData({ organizationName: "Acme Corq" }) },
  }),
  raisedSeats: encode({
    licence: { ...ENTERPRISE, data: withData({ plan: withPlan({ maxMembers: 100000 }) }) },
  }),
  swappedPlan: (() => {
    const pro = decode({
      key: mint({
        data: withData({ licenseId: "lic-e2e-pro", plan: withPlan({ type: "PRO", name: "Pro" }) }),
        privateKey: TEST_PRIVATE_KEY,
      }),
    });
    return encode({ licence: { ...pro, data: { ...pro.data, plan: withPlan({}) } } });
  })(),
  notALicence: Buffer.from("not a licence", "utf-8").toString("base64"),
};

/** Enterprise features each mounted for every organization and gated per organization. */
export const ENTERPRISE_SWEEP = [
  { feature: "SCIM tokens", path: "scimToken.list" },
  { feature: "SCIM syncs", path: "scimReconciliation.getAll" },
  { feature: "groups", path: "group.listAll" },
];

export async function uploadLicence({ page, licenseKey }: { page: Page; licenseKey: string }) {
  const { organizationId } = await getOrgAndTeamIds(page);
  const response = await page.request.post("/api/trpc/license.upload", {
    data: { organizationId, licenseKey },
  });
  return {
    status: response.status(),
    body: JSON.stringify(await response.json().catch(() => null)),
  };
}

export async function thenUploadIsRefused({
  page,
  licenseKey,
  code,
}: {
  page: Page;
  licenseKey: string;
  code: string;
}) {
  const { status, body } = await uploadLicence({ page, licenseKey });
  expect(status, body).toBeGreaterThanOrEqual(400);
  expect(status, body).toBeLessThan(500);
  expect(body).toContain(code);
}

export async function givenLicenceIsInstalled({
  page,
  licenseKey,
}: {
  page: Page;
  licenseKey: string;
}) {
  const { status, body } = await uploadLicence({ page, licenseKey });
  expect(status, body).toBe(200);
}

/** Drops any pasted licence; a refusal for "nothing to remove" is fine, the status check is not. */
export async function givenNoPastedLicence({ page }: { page: Page }) {
  const { organizationId } = await getOrgAndTeamIds(page);
  await page.request.post("/api/trpc/license.remove", { data: { organizationId } });
  await thenNoPastedLicence({ page });
}

export async function thenNoPastedLicence({ page }: { page: Page }) {
  const { organizationId } = await getOrgAndTeamIds(page);
  const response = await page.request.get(
    "/api/trpc/license.getStatus?input=" + encodeURIComponent(JSON.stringify({ organizationId })),
  );
  const body = await response.json();
  expect(body?.result?.data?.hasLicense, JSON.stringify(body)).toBe(false);
}

/** Asks each swept feature for this organization; returns the status per feature. */
export async function sweepEnterpriseFeatures({ page }: { page: Page }) {
  const { organizationId } = await getOrgAndTeamIds(page);
  const input = encodeURIComponent(JSON.stringify({ organizationId }));
  const answers: { feature: string; status: number }[] = [];
  for (const { feature, path } of ENTERPRISE_SWEEP) {
    const response = await page.request.get(`/api/trpc/${path}?input=${input}`);
    answers.push({ feature, status: response.status() });
  }
  return answers;
}

export async function thenEveryFeatureRefuses({ page }: { page: Page }) {
  for (const { feature, status } of await sweepEnterpriseFeatures({ page })) {
    expect(status, feature).toBeGreaterThanOrEqual(400);
    expect(status, `${feature} must be mounted`).not.toBe(404);
    expect(status, feature).toBeLessThan(500);
  }
}

export async function thenEveryFeatureAnswers({ page }: { page: Page }) {
  for (const { feature, status } of await sweepEnterpriseFeatures({ page })) {
    expect(status, feature).toBe(200);
  }
}
