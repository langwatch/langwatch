/**
 * The dictionary is the one list: what it declares, what the sender puts on
 * the wire and what the receiver accepts must agree.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */

import { describe, expect, it } from "vitest";

import {
  USAGE_FIELD_CATEGORIES,
  USAGE_FIELDS,
  USAGE_NEVER_COLLECTED,
  USAGE_REPORT_SCHEMA_VERSION,
  getUsageField,
  usageFieldsOfCategory,
  countUnknownUsageFields,
  optionalUsageReportKeys,
  usageReportBodySchema,
} from "../usage-report.ts";

const RECEIVED = new Set(Object.keys(usageReportBodySchema.shape));

describe("given the dictionary", () => {
  describe("when every field is read", () => {
    /** @scenario "Every field the report carries declares a category and a reason" */
    it("declares a category, a window, a reason and a source", () => {
      for (const field of USAGE_FIELDS) {
        expect(USAGE_FIELD_CATEGORIES, `${field.key} has an unknown category`).toContain(
          field.category,
        );
        expect(field.why.length, `${field.key} has no reason`).toBeGreaterThan(20);
        expect(field.source.length, `${field.key} has no source`).toBeGreaterThan(2);
      }
    });

    it("names each field once", () => {
      const keys = USAGE_FIELDS.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("puts the license channel's own fields on no report", () => {
      // `subscription` is the license channel, which is a separate post with a
      // separate schema. A field of that category appearing here would be the
      // two channels merging, which is the one thing they must not do.
      expect(usageFieldsOfCategory("subscription")).toEqual([]);
    });

    it("gives hostname a switch of its own and nothing else", () => {
      const ownSwitch = USAGE_FIELDS.filter((field) => field.ownSwitch);
      expect(ownSwitch.map((field) => field.key)).toEqual(["hostname"]);
    });

    it("declares exactly the fields the schema version stands for", () => {
      // A field added or removed is a schema version bump, and this is the
      // number that makes somebody notice they owe one.
      expect(USAGE_FIELDS).toHaveLength(102);
      expect(USAGE_REPORT_SCHEMA_VERSION).toBe(3);
    });
  });

  describe("when a figure is counted over time", () => {
    /** @scenario "Counts are reported lifetime and over two windows" */
    it("declares each of the newer families lifetime, over seven days and over twenty-eight", () => {
      const families: [string, string][] = [
        ["spans", "spans"],
        ["gateway_requests", "gateway_requests"],
        ["gateway_spend_usd", "gateway_spend_usd"],
        ["instant_eval_runs", "instant_eval_runs"],
        ["instant_eval_judgments", "instant_eval_judgments"],
        ["langy_turns", "langy_turns"],
        ["langy_active_users", "langy_users"],
        ["coding_agent_sessions", "coding_agent_sessions"],
        ["pull_requests", "pull_requests"],
      ];

      for (const [key, lifetimeKey] of families) {
        expect(getUsageField(lifetimeKey).window, lifetimeKey).toBe("lifetime");
        expect(getUsageField(`${key}_7d`).window, `${key}_7d`).toBe("7d");
        expect(getUsageField(`${key}_28d`).window, `${key}_28d`).toBe("28d");
        for (const field of [lifetimeKey, `${key}_7d`, `${key}_28d`]) {
          expect(getUsageField(field).category).toBe("optional");
        }
      }
    });
  });

  describe("when the ladder is read", () => {
    it("has a rung for the first gateway request, Instant Eval run, Langy turn and coding agent session", () => {
      for (const rung of [
        "first_gateway_request_at",
        "first_instant_eval_run_at",
        "first_langy_turn_at",
        "first_coding_agent_session_at",
      ]) {
        expect(getUsageField(rung), rung).toMatchObject({
          category: "optional",
          window: "point_in_time",
        });
      }
    });
  });
});

describe("given the receiver on the other end", () => {
  describe("when the dictionary names a field", () => {
    /** @scenario "The receiver names every field the dictionary declares" */
    it("names it too, so a declared field is never dropped on arrival", () => {
      const missing = USAGE_FIELDS.filter((field) => !RECEIVED.has(field.key)).map(
        (field) => field.key,
      );

      expect(missing).toEqual([]);
    });
  });
});

describe("given the list of what is never collected", () => {
  describe("when a security review reads it", () => {
    /** @scenario "The docs page states what is never collected" */
    it("names trace content, prompts, addresses, addresses of machines and keys", () => {
      const stated = USAGE_NEVER_COLLECTED.join(" ").toLowerCase();

      for (const subject of [
        "trace",
        "prompt",
        "dataset",
        "evaluation",
        "project names",
        "user names",
        "email addresses",
        "ip addresses",
        "keys",
      ]) {
        expect(stated, `${subject} is not stated`).toContain(subject);
      }
    });

    it("declares no field whose name promises one of them", () => {
      // The two allowed near-misses, both counts rather than contents:
      // `user_email_domains` is the part after the @ with a number beside it,
      // and `email_configured` is whether a mail gateway exists at all.
      const allowed = new Set(["user_email_domains", "email_configured"]);
      const forbidden = ["email", "prompt_text", "content", "api_key"];
      const offenders = USAGE_FIELDS.filter(
        (field) => !allowed.has(field.key) && forbidden.some((word) => field.key.includes(word)),
      );

      expect(offenders.map((field) => field.key)).toEqual([]);
    });
  });
});

describe("given a field a reader looks up by name", () => {
  describe("when it is one the dictionary declares", () => {
    it("comes back with its category and its reason", () => {
      expect(getUsageField("user_email_domains")).toMatchObject({
        category: "optional",
        window: "point_in_time",
      });
      expect(() => getUsageField("nothing_named_this")).toThrow(
        "declares no field named nothing_named_this",
      );
    });
  });
});

describe("given the schema version", () => {
  describe("when a stored report is read back", () => {
    it("is a whole number the report carries", () => {
      expect(Number.isInteger(USAGE_REPORT_SCHEMA_VERSION)).toBe(true);
      expect(getUsageField("report_schema_version").category).toBe("standard");
    });
  });
});

describe("given a report from a newer or older install", () => {
  const report = { event: "daily_usage_stats", instance_id: "install-1", version: "3.1.0" };

  /** @scenario "The receiver accepts a report carrying a field it has never heard of" */
  it("accepts a field it has never heard of, strips it and counts it", () => {
    const sent = { ...report, a_field_from_the_future: 1 };

    const parsed = usageReportBodySchema.safeParse(sent);

    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty("a_field_from_the_future");
    expect(countUnknownUsageFields(sent)).toBe(1);
  });

  /** @scenario "The receiver accepts a report missing fields it expects" */
  it("accepts a report carrying only the event and the instance", () => {
    expect(usageReportBodySchema.validate(report)).toBe(true);
    expect(usageReportBodySchema.validate({ event: "daily_usage_stats" })).toBe(false);
  });

  it("names the optional category's keys for the switch that turns them off", () => {
    expect(optionalUsageReportKeys()).toContain("traces_7d");
    expect(optionalUsageReportKeys()).not.toContain("instance_id");
  });
});
