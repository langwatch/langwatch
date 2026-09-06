/**
 * `actionParams` must never reach machine output.
 *
 * `/api/triggers` returns delivery credentials — Slack webhook URLs, custom
 * endpoint URLs and their headers — in plaintext, and the human "Trigger
 * Details" block has always omitted them. Machine output is the MORE exposed
 * surface (it gets logged, piped, and pasted into agent context, and agent mode
 * auto-activates from CLAUDECODE), so it must not be the one place the secret
 * appears. These tests fail loudly if that ever regresses.
 */
import { describe, it, expect } from "vitest";
import { redactTriggerSecrets, redactTriggerListSecrets } from "../redact";

const WEBHOOK = "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX";

const trigger = () => ({
  id: "trg_1",
  name: "alert me",
  action: "SEND_SLACK_MESSAGE",
  actionParams: { slackWebhook: WEBHOOK, headers: { Authorization: "Bearer sk-live-abc" } },
  active: true,
});

describe("redactTriggerSecrets", () => {
  describe("given a trigger carrying delivery credentials", () => {
    it("removes every actionParams value from the payload", () => {
      const serialized = JSON.stringify(redactTriggerSecrets(trigger()));

      expect(serialized).not.toContain(WEBHOOK);
      expect(serialized).not.toContain("hooks.slack.com");
      expect(serialized).not.toContain("sk-live-abc");
    });

    // An agent needs to know a trigger HAS a slack webhook configured to reason
    // about it; it never needs the value.
    it("keeps the key names so the shape stays readable", () => {
      const redacted = redactTriggerSecrets(trigger());

      expect(Object.keys(redacted.actionParams)).toEqual(["slackWebhook", "headers"]);
    });

    it("leaves every non-secret field untouched", () => {
      const redacted = redactTriggerSecrets(trigger());

      expect(redacted.id).toBe("trg_1");
      expect(redacted.name).toBe("alert me");
      expect(redacted.action).toBe("SEND_SLACK_MESSAGE");
      expect(redacted.active).toBe(true);
    });

    // The `table` closure renders from the original, so mutating it would
    // corrupt human output too.
    it("does not mutate the input", () => {
      const original = trigger();
      redactTriggerSecrets(original);

      expect(original.actionParams.slackWebhook).toBe(WEBHOOK);
    });
  });

  describe("given a trigger with no actionParams", () => {
    it.each([[null], [undefined], [{}]])("returns it unharmed for %s", (params) => {
      const input = { id: "trg_2", actionParams: params as Record<string, unknown> | null };

      expect(() => redactTriggerSecrets(input)).not.toThrow();
      expect(redactTriggerSecrets(input).id).toBe("trg_2");
    });
  });

  // list.ts and create.ts cast the response to types that OMIT actionParams,
  // but the cast is compile-time only and the payload really carries it. If the
  // redactor were typed to require the field, those call sites could not use it
  // and the secret would ship.
  describe("given a payload whose declared type omits actionParams", () => {
    it("still strips the field the API actually returned", () => {
      const declared: { id: string; name: string } = JSON.parse(
        JSON.stringify({ id: "trg_3", name: "x", actionParams: { slackWebhook: WEBHOOK } }),
      );

      expect(JSON.stringify(redactTriggerSecrets(declared))).not.toContain(WEBHOOK);
    });
  });
});

describe("redactTriggerListSecrets", () => {
  it("redacts every element, not just the first", () => {
    const serialized = JSON.stringify(
      redactTriggerListSecrets([trigger(), { ...trigger(), id: "trg_2" }]),
    );

    expect(serialized).not.toContain(WEBHOOK);
    expect(serialized.match(/redacted/g)).toHaveLength(4);
  });
});
