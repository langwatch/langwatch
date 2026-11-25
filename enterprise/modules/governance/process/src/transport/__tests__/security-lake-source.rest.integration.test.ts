// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Adding a Security Lake source over REST with an organisation key: no user created it, so the
 * source names no creator. Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { describe, expect, it } from "vitest";

import { buildApi, KEY, ORG } from "./ocsf-siem.rest.fixtures.ts";

const body = {
  name: "ACME Security Lake",
  config: {
    region: "eu-west-1",
    subscriberRoleArn: "arn:aws:iam::123456789012:role/acme-lake-subscriber",
    queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
  },
  credentials: { aws_access_key_id: "AKIAEXAMPLE", aws_secret_access_key: "secret" },
};

describe("POST /api/governance/security-lake/sources", () => {
  describe("given an organisation service key", () => {
    /** @scenario "A service key adds a Security Lake source with no user as its creator" */
    it("stores the source with no creator", async () => {
      const { post, repositories } = await buildApi({ grants: ["ingestionSources:manage"] });

      const response = await post("/api/governance/security-lake/sources", body);

      expect(response.status).toBe(200);
      const { id } = (await response.json()) as { id: string };
      const stored = await repositories.ingestionSources.findById(id);
      expect(stored?.createdById).toBeNull();
    });
  });

  describe("given a schedule that is empty or not a cron expression", () => {
    /** @scenario "A Security Lake source with an empty or non-cron schedule is refused" */
    it.each(["", "every five minutes", "*/5 * * *"])(
      "refuses the schedule %j and stores nothing",
      async (schedule) => {
        const { post, repositories } = await buildApi({ grants: ["ingestionSources:manage"] });

        const response = await post("/api/governance/security-lake/sources", {
          ...body,
          config: { ...body.config, schedule },
        });

        expect(response.status).toBe(422);
        expect(await repositories.ingestionSources.findAll(ORG)).toEqual([]);
      },
    );
  });
});

describe("PATCH /api/governance/security-lake/sources/:sourceId", () => {
  describe("given a source with S3 and SQS endpoint overrides", () => {
    /** @scenario "An endpoint override sent as null on edit is removed" */
    it("removes an override sent as null and keeps the other", async () => {
      const { post, hono, repositories } = await buildApi({ grants: ["ingestionSources:manage"] });
      const created = await post("/api/governance/security-lake/sources", {
        ...body,
        config: {
          ...body.config,
          s3Endpoint: "https://s3.eu-west-1.amazonaws.com",
          sqsEndpoint: "https://sqs.eu-west-1.amazonaws.com",
        },
      });
      const { id } = (await created.json()) as { id: string };

      const response = await hono.request(`/api/governance/security-lake/sources/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ config: { s3Endpoint: null } }),
      });

      expect(response.status).toBe(200);
      const stored = await repositories.ingestionSources.findById(id);
      expect(stored?.parserConfig).not.toHaveProperty("s3Endpoint");
      expect(stored?.parserConfig).toMatchObject({
        sqsEndpoint: "https://sqs.eu-west-1.amazonaws.com",
        queueUrl: body.config.queueUrl,
      });
    });
  });
});

describe("the Security Lake source name and description limits", () => {
  const patch = (hono: Awaited<ReturnType<typeof buildApi>>["hono"], id: string, bodyOf: unknown) =>
    hono.request(`/api/governance/security-lake/sources/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(bodyOf),
    });

  describe("when a source is added", () => {
    /** @scenario "A Security Lake source name or description past its limit is refused" */
    it("takes a 2,000 character description and refuses a longer one or a 129 character name", async () => {
      const { post } = await buildApi({ grants: ["ingestionSources:manage"] });

      const fits = await post("/api/governance/security-lake/sources", {
        ...body,
        description: "d".repeat(2_000),
      });
      const longDescription = await post("/api/governance/security-lake/sources", {
        ...body,
        description: "d".repeat(2_001),
      });
      const longName = await post("/api/governance/security-lake/sources", {
        ...body,
        name: "n".repeat(129),
      });

      expect(fits.status).toBe(200);
      expect(longDescription.status).toBe(422);
      expect(longName.status).toBe(422);
    });

    it("refuses a body past the JSON body limit before reading it", async () => {
      const { post } = await buildApi({ grants: ["ingestionSources:manage"] });

      const response = await post("/api/governance/security-lake/sources", {
        ...body,
        description: "d".repeat(2 * 1024 * 1024),
      });

      expect(response.status).toBe(413);
    });
  });

  describe("when a source is edited", () => {
    /** @scenario "A Security Lake source name or description past its limit is refused" */
    it("refuses a description over 2,000 characters and keeps the stored one", async () => {
      const { post, hono, repositories } = await buildApi({ grants: ["ingestionSources:manage"] });
      const created = await post("/api/governance/security-lake/sources", {
        ...body,
        description: "ACME lake",
      });
      const { id } = (await created.json()) as { id: string };

      const response = await patch(hono, id, { description: "d".repeat(2_001) });

      expect(response.status).toBe(422);
      expect((await repositories.ingestionSources.findById(id))?.description).toBe("ACME lake");
    });
  });
});
