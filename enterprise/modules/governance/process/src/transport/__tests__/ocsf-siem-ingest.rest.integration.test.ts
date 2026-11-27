/**
 * The OCSF SIEM door over the real governance application and memory repositories: the three
 * export streams, access, paging, filters and the push-in. Spec: specs/ocsf-siem.feature
 */
import { describe, expect, it } from "vitest";

import { KEY, buildApi, type Page, uids, okta } from "./ocsf-siem.rest.fixtures.ts";

describe("the OCSF SIEM REST family: ingest", () => {
  describe("given OCSF events from another source", () => {
    /** @scenario Ingested OCSF events are stored and read back in the export */
    it("stores them and exports them as sent", async () => {
      const { get, post } = await buildApi();

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [okta("o-1"), okta("o-2")],
      });
      const page = (await (
        await get("/api/governance/ocsf/events?source_type=ocsf_push")
      ).json()) as Page;

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 2 });
      expect(page.data).toEqual([okta("o-1"), okta("o-2")]);
    });

    /** @scenario An OCSF event sent twice is stored once */
    it("stores an event sent twice once", async () => {
      const { get, post } = await buildApi();

      await post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] });
      await post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] });
      const page = (await (
        await get("/api/governance/ocsf/events?source_type=ocsf_push")
      ).json()) as Page;

      expect(uids(page)).toEqual(["o-1"]);
    });

    /** @scenario An OCSF event without metadata.uid is refused */
    it("refuses an event with no metadata.uid with 422 naming the field", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-1"), metadata: { version: "1.4.0" } };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
      expect(JSON.stringify(body)).toContain("metadata");
      expect(JSON.stringify(body)).toContain("uid");
    });

    /** @scenario A SIEM reading on with its cursor receives an event pushed in with an earlier time */
    it("returns a back-dated event on the next cursor read", async () => {
      const { get, post } = await buildApi();
      await post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] });
      const first = (await (await get("/api/governance/ocsf/events")).json()) as Page;

      const backDated = { ...okta("o-old"), time: Date.parse("2026-11-09T09:00:00Z") };
      await post("/api/governance/ocsf/ingest", { source: "okta", events: [backDated] });
      const next = (await (
        await get(`/api/governance/ocsf/events?cursor=${first.next_cursor}`)
      ).json()) as Page;

      expect(uids(first)).toEqual(["o-1"]);
      expect(uids(next)).toEqual(["o-old"]);
    });

    /** @scenario A push-in body over the bulk body limit is refused with 413 */
    it("answers 413 for a 40 MB body", async () => {
      const { hono } = await buildApi();

      const response = await hono.request("/api/governance/ocsf/ingest", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "okta",
          events: [okta("o-1")],
          pad: "x".repeat(40_000_000),
        }),
      });

      expect(response.status).toBe(413);
    });

    /** @scenario An event over 64 KiB of UTF-8 is refused even when it holds fewer characters */
    it("counts the 64 KiB limit in UTF-8 bytes", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-1"), message: "\u00e9".repeat(40_000) };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });

      expect(JSON.stringify(event).length).toBeLessThan(64 * 1024);
      expect(response.status).toBe(422);
    });

    /** @scenario An event with a class_uid outside the OCSF range is refused */
    it("refuses a class_uid past six digits with 422", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-1"), class_uid: 99_999_999_999 };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).toContain("class_uid");
    });

    /** @scenario An event timed more than a day ahead is refused */
    it("refuses an event two days in the future with 422", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-ahead"), time: Date.now() + 2 * 24 * 60 * 60 * 1000 };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).toContain("time");
    });

    /** @scenario An event timed before the year 2000 is refused */
    it("refuses an event timed in 1970 with 422", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-1970"), time: 1_000 };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).toContain("time");
    });

    /** @scenario A seat report pushed in from another source leaves the seat figures alone */
    it("keeps an ingested seat_report out of the seat reports", async () => {
      const { post, seatReports } = await buildApi();
      const forged = {
        ...okta("o-seat"),
        api: { operation: "seat_report" },
        metadata: {
          uid: "o-seat",
          version: "1.4.0",
          extension: { skuPartNumber: "SKU", seatsBought: 9999, seatsAssigned: 8888 },
        },
      };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [forged],
      });

      expect(response.status).toBe(200);
      expect(await seatReports()).toEqual([]);
    });

    /** @scenario Each push-in batch leaves one audit row without the events */
    it("writes one audit row per batch with no event payload", async () => {
      const { post, audits } = await buildApi();

      await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [okta("o-1"), okta("o-2")],
      });

      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0])).toContain("governance.ocsfEvents.ingest");
      expect(JSON.stringify(audits[0])).not.toContain("Okta");
    });

    /** @scenario A key without governance:manage cannot push events in */
    it("answers 403 for a key holding only complianceExport:view", async () => {
      const { post } = await buildApi({ grants: ["complianceExport:view"] });

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [okta("o-1")],
      });

      expect(response.status).toBe(403);
    });
  });
});
