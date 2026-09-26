/**
 * The report one install would send right now: the optional category switches
 * off whole, hostname on its own, and domains arrive as counts.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { USAGE_FIELDS } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type UsageReportCollectInput,
  UsageReportCollectionService,
} from "../usage-report-collection.service.ts";
import { UsageReportWorld } from "./support/usage-report-peers.ts";

const NOW = Temporal.Instant.from("2026-09-21T12:00:00.000Z");
const INSTANCE_ID = "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77";
const at = (iso: string) => Temporal.Instant.from(iso);
const day = (iso: string) => Date.parse(iso);

let state: UsageReportWorld;

function collector() {
  return UsageReportCollectionService.create({
    peers: state.peers(),
    deployment: () => ({
      version: "3.17.0",
      installMethod: "helm",
      chartVersion: undefined,
      environment: "production",
      hostname: "langwatch.acme.test",
    }),
  });
}

function report(overrides: Partial<UsageReportCollectInput> = {}) {
  return collector().collect({
    organizationIds: ["org-1"],
    instanceId: INSTANCE_ID,
    firstSeenAt: undefined,
    connected: false,
    now: NOW,
    ...overrides,
  });
}

/** One row per figure in each project; each gateway row lands on its project's own day. */
function seedTwoOrganizations(): void {
  state.projectsByOrganization.set("org-1", ["project-1"]);
  state.projectsByOrganization.set("org-2", ["project-2"]);
  for (const projectId of ["project-1", "project-2"]) {
    for (const figure of ["traces", "scenario_runs", "spans", "instant_eval_runs"] as const) {
      state.rows.push({ projectId, figure, at: day("2026-09-20T00:00:00Z") });
    }
    state.rows.push({
      projectId,
      figure: "coding_agent_sessions",
      at: day("2026-04-01T00:00:00Z"),
    });
  }
  state.rows.push({
    projectId: "project-2",
    figure: "gateway",
    at: day("2026-02-01T00:00:00Z"),
    costUsd: 1.25,
  });
  state.rows.push({
    projectId: "project-1",
    figure: "gateway",
    at: day("2026-09-20T00:00:00Z"),
    costUsd: 1.25,
  });
}

beforeEach(() => {
  state = UsageReportWorld.create();
  state.projectsByOrganization.set("org-1", ["project-1"]);
});

describe("given an install with the report switched fully on", () => {
  describe("when the report is taken", () => {
    /** @scenario "Every field the report carries declares a category and a reason" */
    it("carries only fields the dictionary declares", async () => {
      const declared = new Set(USAGE_FIELDS.map((field) => field.key));

      const payload = await report({ firstSeenAt: at("2026-01-01T00:00:00Z") });

      expect(Object.keys(payload).filter((key) => !declared.has(key))).toEqual([]);
      expect(payload.first_seen_at).toBe("2026-01-01T00:00:00.000Z");
    });

    /** @scenario "The report names the install and not its organizations" */
    it("names the install by its minted identity and nothing else", async () => {
      const payload = await report();

      expect(payload.instance_id).toBe(INSTANCE_ID);
      expect(JSON.stringify(payload)).not.toContain("org-1");
    });

    /** @scenario "Company identity travels as aggregated domains, never an address" */
    it("carries the domains the database counted, and no address", async () => {
      state.emailDomains = { "acme.test": 2, "other.test": 1 };

      const payload = await report();

      expect(payload.user_email_domains).toEqual({ "acme.test": 2, "other.test": 1 });
      expect(JSON.stringify(payload)).not.toContain("@");
    });

    it("reports whether its license names a hosted service", async () => {
      expect((await report({ connected: true })).connected).toBe(true);
    });

    it("counts what ClickHouse holds for every organization it carries", async () => {
      seedTwoOrganizations();

      const payload = await report({ organizationIds: ["org-1", "org-2"] });

      expect(payload).toMatchObject({
        totalTraces: 2,
        totalScenarioEvents: 2,
        spans: 2,
        spans_7d: 2,
        spans_28d: 2,
        gateway_requests: 2,
        gateway_requests_28d: 1,
        gateway_spend_usd: 2.5,
        gateway_spend_usd_7d: 1.25,
        instant_eval_runs: 2,
        coding_agent_sessions: 2,
        coding_agent_sessions_28d: 0,
      });
    });

    it("dates each ClickHouse rung from the earliest organization, and null where none reached it", async () => {
      seedTwoOrganizations();

      const payload = await report({ organizationIds: ["org-1", "org-2"] });

      expect(payload.first_gateway_request_at).toBe("2026-02-01T00:00:00.000Z");
      expect(payload.first_coding_agent_session_at).toBe("2026-04-01T00:00:00.000Z");
      expect(payload.first_instant_eval_run_at).toBe("2026-09-20T00:00:00.000Z");
      expect(payload.first_langy_turn_at).toBeNull();
    });
  });
});

describe("given the owners of the deployment facts", () => {
  describe("when the report is taken", () => {
    it("names the sign-in, the storage and the mail as each owner answers them", async () => {
      state.authProvider = "auth0";
      state.mailProvider = "smtp";
      state.storageDestination = { kind: "s3", bucket: "langwatch-objects" };

      const payload = await report();

      expect(payload.auth_method).toBe("auth0");
      expect(payload.storage_backend).toBe("s3");
      expect(payload.email_configured).toBe(true);
    });

    it("leaves the sign-in out where this process composes no sign-in mode", async () => {
      state.authProvider = undefined;

      const payload = await report();

      expect(payload).not.toHaveProperty("auth_method");
      expect(payload.storage_backend).toBe("local");
      expect(payload.email_configured).toBe(false);
    });
  });
});

describe("given a customer who switched the optional category off", () => {
  describe("when the report is taken", () => {
    /** @scenario "Switching the optional category off removes it from the report" */
    it("still says which release runs and how big the install is", async () => {
      state.emailDomains = { "acme.test": 1 };

      const payload = await report({ switches: { optional: false, hostname: false } });

      expect(payload.version).toBe("3.17.0");
      expect(payload.projects).toBe(1);
      expect(payload.user_email_domains).toBeUndefined();
      expect(payload.hostname).toBeUndefined();
      expect(payload.totalTraces).toBeUndefined();
      expect(payload.first_project_at).toBeUndefined();
    });
  });
});

describe("given a customer who switched hostname off and nothing else", () => {
  describe("when the report is taken", () => {
    /** @scenario "Hostname has a switch of its own" */
    it("keeps the rest of the optional category", async () => {
      state.emailDomains = { "acme.test": 1 };

      const payload = await report({ switches: { optional: true, hostname: false } });

      expect(payload.hostname).toBeUndefined();
      expect(payload.user_email_domains).toEqual({ "acme.test": 1 });
    });
  });
});

describe("given a figure that is counted over time", () => {
  describe("when the report is taken", () => {
    /** @scenario "Counts are reported lifetime and over two windows" */
    it("carries it three times: lifetime, seven days and twenty-eight", async () => {
      const payload = await report();

      for (const key of [
        "annotations",
        "annotations_7d",
        "annotations_28d",
        "datasets",
        "datasets_7d",
        "datasets_28d",
        "totalTraces",
        "traces_7d",
        "traces_28d",
        "langy_users",
        "langy_active_users_7d",
        "langy_active_users_28d",
        "pull_requests",
        "pull_requests_7d",
        "pull_requests_28d",
      ]) {
        expect(payload, `${key} is missing`).toHaveProperty(key);
      }
    });
  });
});

describe("given an install with an organization and no project yet", () => {
  describe("when the report is taken", () => {
    it("still reports, without the figures a project would scope", async () => {
      state.projectsByOrganization.set("org-1", []);
      state.emailDomains = { "acme.test": 1 };

      const payload = await report();

      expect(payload.projects).toBe(0);
      expect(payload.user_email_domains).toEqual({ "acme.test": 1 });
      expect(payload.annotations).toBeUndefined();
      expect(payload.first_project_at).toBeUndefined();
    });
  });
});

describe("given an install carrying no organization", () => {
  describe("when the report is taken", () => {
    it("refuses, because there is nothing to report", async () => {
      await expect(report({ organizationIds: [] })).rejects.toThrow(
        "an install with no organization has nothing to report",
      );
    });
  });
});

describe("given an install with two organizations", () => {
  describe("when one organization's figures are taken", () => {
    it("counts that organization's projects only, and nothing install-wide", async () => {
      seedTwoOrganizations();
      state.emailDomains = { "acme.test": 2 };

      const payload = await collector().collectForOrganization({
        organizationId: "org-1",
        now: NOW,
      });

      expect(payload).toMatchObject({
        organizations: 1,
        projects: 1,
        totalTraces: 1,
        gateway_requests: 1,
        gateway_spend_usd: 1.25,
      });
      for (const key of [
        "instance_id",
        "version",
        "hostname",
        "user_email_domains",
        "active_users_28d",
      ]) {
        expect(payload).not.toHaveProperty(key);
      }
    });
  });
});
