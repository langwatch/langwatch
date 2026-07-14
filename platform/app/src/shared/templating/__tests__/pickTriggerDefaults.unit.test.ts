import { describe, expect, it } from "vitest";
import {
  ALERT_TRIGGER_DEFAULTS,
  DEFAULT_ALERT_EMAIL_BODY_TEMPLATE,
  DEFAULT_ALERT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_ALERT_SLACK_TEMPLATE,
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
  pickTriggerDefaults,
  TRACE_TRIGGER_DEFAULTS,
} from "../defaults";

describe("pickTriggerDefaults", () => {
  describe("when hasCustomGraph is true (graph alert)", () => {
    it("returns the alert-default template set", () => {
      const defaults = pickTriggerDefaults({ hasCustomGraph: true });
      expect(defaults).toBe(ALERT_TRIGGER_DEFAULTS);
      expect(defaults.emailSubject).toBe(DEFAULT_ALERT_EMAIL_SUBJECT_TEMPLATE);
      expect(defaults.emailBody).toBe(DEFAULT_ALERT_EMAIL_BODY_TEMPLATE);
      expect(defaults.slackString).toBe(DEFAULT_ALERT_SLACK_TEMPLATE);
      expect(defaults.slackBlockKit).toBe(
        DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE,
      );
    });

    it("uses the alert-shape subject prefix [Alert]", () => {
      const defaults = pickTriggerDefaults({ hasCustomGraph: true });
      expect(defaults.emailSubject.startsWith("[Alert]")).toBe(true);
    });
  });

  describe("when hasCustomGraph is false (trace trigger)", () => {
    it("returns the trace-default template set", () => {
      const defaults = pickTriggerDefaults({ hasCustomGraph: false });
      expect(defaults).toBe(TRACE_TRIGGER_DEFAULTS);
      expect(defaults.emailSubject).toBe(DEFAULT_EMAIL_SUBJECT_TEMPLATE);
      expect(defaults.emailBody).toBe(DEFAULT_EMAIL_BODY_TEMPLATE);
      expect(defaults.slackString).toBe(DEFAULT_SLACK_TEMPLATE);
      expect(defaults.slackBlockKit).toBe(DEFAULT_SLACK_BLOCK_KIT_TEMPLATE);
    });
  });

  it("trace and alert default sets are distinct", () => {
    expect(ALERT_TRIGGER_DEFAULTS.emailSubject).not.toBe(
      TRACE_TRIGGER_DEFAULTS.emailSubject,
    );
    expect(ALERT_TRIGGER_DEFAULTS.emailBody).not.toBe(
      TRACE_TRIGGER_DEFAULTS.emailBody,
    );
    expect(ALERT_TRIGGER_DEFAULTS.slackString).not.toBe(
      TRACE_TRIGGER_DEFAULTS.slackString,
    );
  });
});
