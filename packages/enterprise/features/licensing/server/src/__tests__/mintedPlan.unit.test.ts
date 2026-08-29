// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * See specs/licensing/self-hosted-license-floor.feature.
 *
 * A license is issued by a control plane that deploys continuously, to
 * deployments that upgrade whenever they feel like it. So the payload we sign
 * today has to stay readable by the versions already in the field, and the
 * cost of getting that wrong is the worst one available: an unparseable
 * license falls back to the free plan, so a renewal would lock a paying
 * customer down to a single seat.
 */
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { LicenseGenerationService, NodeLicenseCryptographyAdapter } from "../index";
import { buildMintedPlan } from "@langwatch/enterprise-licensing-contract";

/**
 * The plan schema as it shipped BEFORE the fields below became optional, kept
 * verbatim so this test fails if we stop minting something an older deployment
 * still demands. `maxProjects` and `maxWorkflows` are required here on purpose.
 */
const releasedPlanSchema = z.object({
  type: z.string(),
  name: z.string(),
  maxMembers: z.number(),
  maxMembersLite: z.number().optional(),
  maxTeams: z.number().optional(),
  maxProjects: z.number(),
  maxMessagesPerMonth: z.number(),
  evaluationsCredit: z.number().optional(),
  maxWorkflows: z.number(),
  canPublish: z.boolean(),
  usageUnit: z.string().optional(),
});

// Generated for the test only; never used to sign anything real.
const TEST_KEYS = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const generation = LicenseGenerationService.create(
  NodeLicenseCryptographyAdapter.create(),
);
const generateLicenseKey = generation.generate.bind(generation);

describe("buildMintedPlan", () => {
  describe("given a plan built for signing", () => {
    it("carries the retired fields older deployments still require", () => {
      const plan = buildMintedPlan({
        type: "ENTERPRISE",
        name: "Enterprise",
        maxMembers: 100,
        maxMembersLite: 50,
        maxMessagesPerMonth: 10_000_000,
        canPublish: true,
        usageUnit: "traces",
      });

      expect(plan.maxProjects).toBeTypeOf("number");
      expect(plan.maxWorkflows).toBeTypeOf("number");
    });

    it("orders keys to the schema, since the signature covers the serialization", () => {
      const plan = buildMintedPlan({
        type: "PRO",
        name: "Pro",
        maxMembers: 10,
        maxMembersLite: 5,
        maxMessagesPerMonth: 100_000,
        canPublish: true,
        webhookEndpointsEnabled: false,
        usageUnit: "traces",
      });

      expect(Object.keys(plan)).toEqual([
        "type",
        "name",
        "maxMembers",
        "maxMembersLite",
        "maxProjects",
        "maxMessagesPerMonth",
        "maxWorkflows",
        "canPublish",
        "webhookEndpointsEnabled",
        "usageUnit",
      ]);
    });

    it("mints the webhook entitlement the license sells", () => {
      const plan = buildMintedPlan({
        type: "ENTERPRISE",
        name: "Enterprise",
        maxMembers: 100,
        maxMembersLite: 50,
        maxMessagesPerMonth: 10_000_000,
        canPublish: true,
        webhookEndpointsEnabled: true,
        usageUnit: "traces",
      });

      expect(plan.webhookEndpointsEnabled).toBe(true);
    });
  });
});

describe("generateLicenseKey", () => {
  describe("given a license minted today and read by a previously released deployment", () => {
    it("still parses under the schema that shipped before those fields were optional", () => {
      const { licenseKey } = generateLicenseKey({
        organizationName: "ACME",
        email: "ops@acme.test",
        planType: "ENTERPRISE",
        maxMembers: 100,
        privateKey: TEST_KEYS.privateKey,
      });

      // Decoded the way an older deployment decodes it: base64 to JSON.
      const decoded = JSON.parse(Buffer.from(licenseKey, "base64").toString("utf-8"));

      // The parse is the assertion: the released schema rejects a payload
      // missing maxProjects or maxWorkflows, which is what drops an older
      // deployment to the one-seat free plan.
      expect(() => releasedPlanSchema.parse(decoded.data.plan)).not.toThrow();
    });
  });
});
