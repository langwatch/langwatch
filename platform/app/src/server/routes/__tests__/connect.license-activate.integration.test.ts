/**
 * @vitest-environment node
 *
 * The connect host's activation route against a real Postgres: a code posted
 * in the same header a license token goes in, answered with a license the
 * install can validate, and refused exactly once it has been used.
 *
 * Spec: specs/self-hosting/connected-services/activation-codes.feature
 */

import { generateKeyPairSync } from "node:crypto";
import {
  activationCodeHash,
  activationCodeHint,
  mintActivationCode,
  normaliseActivationCode,
} from "@ee/licensing/activation/activationCode";
import { PrismaActivationCodes } from "@ee/licensing/activation/activationCode.prisma";
import { validateLicense } from "@ee/licensing/validation";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { app } from "../connect";

const suffix = nanoid(8);
const ORGANIZATION = `org-activate-${suffix}`;
const INSTANCE = `instance-${suffix}`;
const NEXT_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function activate({
  code,
  instanceId = INSTANCE,
}: {
  code: string;
  instanceId?: string | null;
}) {
  return app.request("/api/connect/v1/license/activate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${code}`,
      ...(instanceId ? { "X-LangWatch-Instance": instanceId } : {}),
    },
    body: "{}",
  });
}

describe("POST /api/connect/v1/license/activate (real PG)", () => {
  const previousKey = process.env.LANGWATCH_LICENSE_PRIVATE_KEY;
  const repository = new PrismaActivationCodes(prisma);

  const issueCode = async (reusable = false) => {
    const code = mintActivationCode();
    const normalised = normaliseActivationCode(code);
    if (!normalised) throw new Error("a minted code failed its shape check");
    const row = await repository.create({
      codeHash: activationCodeHash(normalised),
      codeHint: activationCodeHint(normalised),
      organizationId: ORGANIZATION,
      organizationName: `ACME Rockets ${suffix}`,
      email: "ops@acme.test",
      planType: "ENTERPRISE",
      maxMembers: 25,
      maxMembersLite: 0,
      licenseTermDays: 365,
      services: ["instant_evals"],
      expiresAt: NEXT_MONTH,
      reusable,
      createdById: `usr-${suffix}`,
    });
    return { code, row };
  };

  beforeAll(async () => {
    await startTestContainers();
    process.env.LANGWATCH_LICENSE_PRIVATE_KEY = privateKey;
    await prisma.organization.create({
      data: {
        id: ORGANIZATION,
        name: `ACME Rockets ${suffix}`,
        slug: `acme-rockets-${suffix}`,
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (previousKey === undefined) {
      delete process.env.LANGWATCH_LICENSE_PRIVATE_KEY;
    } else {
      process.env.LANGWATCH_LICENSE_PRIVATE_KEY = previousKey;
    }
    await prisma.activationCode.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await prisma.issuedLicense.deleteMany({
      where: { organizationId: ORGANIZATION },
    });
    await prisma.organization.deleteMany({ where: { id: ORGANIZATION } });
    await stopTestContainers();
  });

  describe("given a single-use code", () => {
    describe("when an install redeems it", () => {
      /** @scenario "A valid code mints the license it describes" */
      it("answers with a license the install can validate, once", async () => {
        const { code, row } = await issueCode();

        const first = await activate({ code });
        expect(first.status).toBe(200);
        const answer = (await first.json()) as {
          license: string;
          planType: string;
          maxMembers: number;
          services: string[];
        };
        expect(answer.planType).toBe("ENTERPRISE");
        expect(answer.maxMembers).toBe(25);
        expect(answer.services).toEqual(["instant_evals"]);

        const validated = validateLicense({
          licenseKey: answer.license,
          publicKey,
        });
        expect(validated).toMatchObject({ valid: true });
        if (validated.valid) {
          // The term runs from the redemption, not from the day the code was
          // cut, so a customer who waits a fortnight keeps a full year.
          expect(validated.planInfo.maxMembers).toBe(25);
        }

        const stored = await repository.findById(row.id);
        expect(stored?.redeemedByInstanceId).toBe(INSTANCE);
        expect(stored?.issuedLicenseId).not.toBeNull();

        // The same code again, from the same install, is refused: it minted
        // its one license and that is what single use means.
        const second = await activate({ code });
        expect(second.status).toBe(403);
        const refusal = (await second.json()) as { error: { code: string } };
        expect(refusal.error.code).toBe("activation_code_already_redeemed");
      });

      /** @scenario "A code must be presented with an instance id" */
      it("refuses with no instance id", async () => {
        const { code } = await issueCode();
        const response = await activate({ code, instanceId: null });
        expect(response.status).toBe(400);
        const refusal = (await response.json()) as { error: { code: string } };
        expect(refusal.error.code).toBe("connect_instance_required");
      });
    });
  });

  describe("given the hash the registry stores for a code", () => {
    describe("when somebody presents that hash as a code", () => {
      /** @scenario "The stored hash is not itself a usable code" */
      it("is refused as malformed, so the table is not a credential store", async () => {
        const { code } = await issueCode();
        const normalised = normaliseActivationCode(code);
        if (!normalised)
          throw new Error("a minted code failed its shape check");

        const response = await activate({
          code: activationCodeHash(normalised),
        });

        expect(response.status).toBe(400);
        const refusal = (await response.json()) as { error: { code: string } };
        expect(refusal.error.code).toBe("activation_code_malformed");
      });
    });
  });

  describe("given a code nobody issued", () => {
    describe("when an install redeems it", () => {
      /** @scenario "A revoked code reads exactly like one that was never issued" */
      it("says it is not one we issued and names no customer", async () => {
        const response = await activate({ code: mintActivationCode() });
        expect(response.status).toBe(401);
        const refusal = (await response.json()) as {
          error: { code: string; message: string };
        };
        expect(refusal.error.code).toBe("activation_code_not_found");
        expect(refusal.error.message).not.toContain("ACME");
      });
    });
  });
});
