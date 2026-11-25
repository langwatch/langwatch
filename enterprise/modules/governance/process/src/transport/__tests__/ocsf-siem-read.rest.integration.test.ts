/**
 * The OCSF SIEM door over the real governance application and memory repositories: the three
 * export streams, access, paging, filters and the push-in. Spec: specs/ocsf-siem.feature
 */
import { describe, expect, it } from "vitest";

import {
  governanceEvent,
  summary,
  auditEntry,
  buildApi,
  type Page,
  type TraceQuery,
  uids,
  okta,
} from "./ocsf-siem.rest.fixtures.ts";

describe("the OCSF SIEM REST family", () => {
  describe("given three governance events", () => {
    /** @scenario A key holding complianceExport:view pages the governance events with a cursor */
    it("pages them with a cursor and has_more", async () => {
      const { get, seed } = await buildApi();
      await seed([
        governanceEvent("e-1", "2026-11-10T10:00:00Z"),
        governanceEvent("e-2", "2026-11-10T11:00:00Z"),
        governanceEvent("e-3", "2026-11-10T12:00:00Z"),
      ]);

      const first = await get("/api/governance/ocsf/events?limit=2");
      const firstBody = (await first.json()) as Page;
      const second = (await (
        await get(`/api/governance/ocsf/events?limit=2&cursor=${firstBody.next_cursor}`)
      ).json()) as Page;

      expect(first.status).toBe(200);
      expect(firstBody.ocsf_version).toBe("1.9.0");
      expect(uids(firstBody)).toEqual(["e-1", "e-2"]);
      expect(firstBody.has_more).toBe(true);
      expect(firstBody.data[0]).toMatchObject({
        class_uid: 6003,
        ai_model: { name: "gpt-5-mini", ai_provider: "openai" },
      });
      expect(uids(second)).toEqual(["e-3"]);
      expect(second.has_more).toBe(false);
      expect(second.next_cursor).toBeTruthy();
    });
  });

  describe("given events from two source types on two days", () => {
    /** @scenario The export filters governance events by time range and source type */
    it("returns only the source type's events since the second day", async () => {
      const { get, seed } = await buildApi();
      await seed([
        governanceEvent("old-a", "2026-11-09T10:00:00Z", "otel_generic"),
        governanceEvent("new-a", "2026-11-10T10:00:00Z", "otel_generic"),
        governanceEvent("new-b", "2026-11-10T11:00:00Z", "claude_compliance"),
      ]);

      const page = (await (
        await get(
          "/api/governance/ocsf/events?source_type=otel_generic&since=2026-11-10T00:00:00Z&until=2026-11-11T00:00:00Z",
        )
      ).json()) as Page;

      expect(uids(page)).toEqual(["new-a"]);
    });
  });

  describe("given a key holding only governance:view", () => {
    /** @scenario A key without complianceExport:view is refused */
    it("answers 403", async () => {
      const { get } = await buildApi({ grants: ["governance:view"] });

      const response = await get("/api/governance/ocsf/events");

      expect(response.status).toBe(403);
    });
  });

  describe("given an organisation on the Growth plan", () => {
    /** @scenario An organisation off the Enterprise plan is refused the export */
    it("answers 402 enterprise_plan_required on every route", async () => {
      const { get, post } = await buildApi({ planType: "GROWTH" });

      const answers = await Promise.all([
        get("/api/governance/ocsf/events"),
        get("/api/governance/ocsf/traces"),
        get("/api/governance/ocsf/audit"),
        post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] }),
      ]);

      for (const answer of answers) {
        expect(answer.status).toBe(402);
        expect(await answer.json()).toMatchObject({ code: "enterprise_plan_required" });
      }
    });
  });

  describe("given a cursor the export did not issue", () => {
    /** @scenario A cursor the export did not issue is a validation error */
    it("answers 422 validation_error", async () => {
      const { get } = await buildApi();

      const response = await get("/api/governance/ocsf/events?cursor=not-a-cursor");
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
    });
  });

  describe("given a since or until before 1970", () => {
    /** @scenario A since or until before 1970 is a validation error on every stream */
    it("answers 422 validation_error on every stream", async () => {
      const { get } = await buildApi();
      const early = "0001-01-01T00:00:00Z";

      const paths = ["events", "traces", "audit"].flatMap((stream) => [
        `/api/governance/ocsf/${stream}?since=${early}`,
        `/api/governance/ocsf/${stream}?until=${early}`,
      ]);

      for (const path of paths) {
        const answer = await get(path);
        expect(answer.status).toBe(422);
        expect(await answer.json()).toMatchObject({ code: "validation_error" });
      }
    });
  });

  describe("given a since or until with no time or offset", () => {
    /** @scenario A since or until that is not a full instant is a validation error on every stream */
    it("answers 422 validation_error on every stream", async () => {
      const { get } = await buildApi();
      const dateOnly = "2026-01-01";

      const paths = ["events", "traces", "audit"].flatMap((stream) => [
        `/api/governance/ocsf/${stream}?since=${dateOnly}`,
        `/api/governance/ocsf/${stream}?until=${dateOnly}`,
      ]);

      for (const path of paths) {
        const answer = await get(path);
        expect(answer.status).toBe(422);
        expect(await answer.json()).toMatchObject({ code: "validation_error" });
      }
    });
  });

  describe("given each project holds one trace", () => {
    /** @scenario The project traces stream walks every project and resumes from its cursor */
    it("returns both traces and ends with a cursor for the next window", async () => {
      const { get } = await buildApi({
        traces: { "project-a": [summary("t-a")], "project-b": [summary("t-b")] },
      });

      const seen: string[] = [];
      let cursor: string | undefined;
      let page: Page;
      do {
        const query = cursor
          ? `?until=2026-11-11T00:00:00Z&cursor=${cursor}`
          : "?until=2026-11-11T00:00:00Z";
        page = (await (await get(`/api/governance/ocsf/traces${query}`)).json()) as Page;
        seen.push(...uids(page));
        cursor = page.next_cursor;
      } while (page.has_more);

      expect(seen).toEqual(["trace:project-a:t-a", "trace:project-b:t-b"]);
      const resume = JSON.parse(Buffer.from(page.next_cursor, "base64url").toString("utf8")) as {
        f: number;
        p: string | null;
      };
      expect(resume).toMatchObject({ p: null, f: Date.parse("2026-11-11T00:00:00Z") });
    });

    /** @scenario A later page of the project traces stream reads up to the until it is sent */
    it("bounds the next page by the until sent with it", async () => {
      const traceQueries: TraceQuery[] = [];
      const { get } = await buildApi({
        traces: { "project-a": [summary("t-a")], "project-b": [summary("t-b")] },
        traceQueries,
      });

      const first = (await (
        await get("/api/governance/ocsf/traces?until=2026-11-11T00:00:00Z")
      ).json()) as Page;
      await get(
        `/api/governance/ocsf/traces?until=2026-11-12T00:00:00Z&cursor=${first.next_cursor}`,
      );

      expect(first.has_more).toBe(true);
      expect(traceQueries.map((query) => query.endDate)).toEqual([
        Date.parse("2026-11-11T00:00:00Z"),
        Date.parse("2026-11-12T00:00:00Z"),
      ]);
    });

    /** @scenario The next traces window opens where the reads covered, not at a later until */
    it("opens the next window at the bound the reads covered", async () => {
      const covered = Date.parse("2026-11-10T12:00:00Z");
      const traceQueries: TraceQuery[] = [];
      const { get } = await buildApi({
        traces: { "project-a": [summary("t-a")], "project-b": [summary("t-b")] },
        traceQueries,
        updatedThrough: covered,
      });

      let cursor: string | undefined;
      let page: Page;
      do {
        const query = cursor
          ? `?until=2999-01-01T00:00:00Z&cursor=${cursor}`
          : "?until=2999-01-01T00:00:00Z";
        page = (await (await get(`/api/governance/ocsf/traces${query}`)).json()) as Page;
        cursor = page.next_cursor;
      } while (page.has_more);

      const resume = JSON.parse(Buffer.from(page.next_cursor, "base64url").toString("utf8")) as {
        f: number;
        p: string | null;
      };
      expect(resume).toMatchObject({ p: null, f: covered });
      for (const query of traceQueries) {
        expect(query.endDate).toBeLessThanOrEqual(Date.now());
      }
    });

    /** @scenario A project outside the organisation is refused on the project traces stream */
    it("refuses a project of another organisation with 422", async () => {
      const { get } = await buildApi();

      const response = await get("/api/governance/ocsf/traces?project_id=project-elsewhere");
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
    });
  });

  describe("given three audit entries", () => {
    /** @scenario The audit stream lists the organisation's audit entries after a cursor */
    it("returns them in order across two pages", async () => {
      const { get } = await buildApi({
        audit: [
          auditEntry("a-1", "2026-11-10T10:00:00Z"),
          auditEntry("a-2", "2026-11-10T11:00:00Z"),
          auditEntry("a-3", "2026-11-10T12:00:00Z"),
        ],
      });

      const first = (await (await get("/api/governance/ocsf/audit?limit=2")).json()) as Page;
      const second = (await (
        await get(`/api/governance/ocsf/audit?limit=2&cursor=${first.next_cursor}`)
      ).json()) as Page;

      expect(uids(first)).toEqual(["audit:a-1", "audit:a-2"]);
      expect(first.has_more).toBe(true);
      expect(uids(second)).toEqual(["audit:a-3"]);
      expect(second.has_more).toBe(false);
      expect(first.data[0]).toMatchObject({ activity_id: 3, actor: { user: { uid: "user-1" } } });
    });
  });

  describe("given an audit entry written a minute ago", () => {
    /** @scenario The audit stream holds back entries younger than ten minutes */
    it("holds it back until it is ten minutes old", async () => {
      const recent = new Date(Date.now() - 60_000).toISOString();
      const { get } = await buildApi({
        audit: [auditEntry("a-old", "2026-11-10T10:00:00Z"), auditEntry("a-new", recent)],
      });

      const page = (await (await get("/api/governance/ocsf/audit?limit=10")).json()) as Page;

      expect(uids(page)).toEqual(["audit:a-old"]);
    });
  });
});
