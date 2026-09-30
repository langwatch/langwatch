import { TriggerAction, WEBHOOK_HEADER_VALUE_KEPT } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import {
  assertHeaderValuesTravelWithTheirDestination,
  assertActionParamsFieldsAreThisChannels,
  REDACTED_CREDENTIAL,
  replaceCredentialsWithPlaceholder,
  resolveCredentialPlaceholders,
  splitStoredRuleFromDelivery,
} from "../trigger-redaction.rules.ts";

describe("the public API's credential placeholder", () => {
  describe("given a webhook automation read back by its provider", () => {
    /** @scenario "The delivery shape survives redaction" */
    it("keeps the destination and header names, and hides every value", () => {
      const read = replaceCredentialsWithPlaceholder({
        action: TriggerAction.SEND_WEBHOOK,
        params: {
          url: "https://x.example.com",
          headers: { Authorization: "__kept__" },
          signingSecret: "s",
        },
      });
      expect(read).toEqual({
        url: "https://x.example.com",
        headers: { Authorization: REDACTED_CREDENTIAL },
        signingSecret: REDACTED_CREDENTIAL,
      });
    });

    it("reports an unsigned automation as unsigned rather than as a secret", () => {
      const read = replaceCredentialsWithPlaceholder({
        action: TriggerAction.SEND_WEBHOOK,
        params: { url: "https://x.example.com", signingSecret: null },
      });
      expect(read.signingSecret).toBeNull();
    });
  });

  describe("given a channel whose delivery carries no credential", () => {
    it("returns the delivery configuration unchanged", () => {
      const params = { members: ["a@example.com"] };
      expect(
        replaceCredentialsWithPlaceholder({ action: TriggerAction.SEND_EMAIL, params }),
      ).toEqual(params);
    });
  });

  describe("given a save that sends the placeholder back", () => {
    /** @scenario "An integrator writes the read response back and the stored credential survives" */
    it("reads it as the channel's kept sentinel", () => {
      const resolved = resolveCredentialPlaceholders({
        action: TriggerAction.SEND_WEBHOOK,
        incoming: { url: "https://x.example.com", headers: { Authorization: REDACTED_CREDENTIAL } },
      });
      expect(resolved.headers).toEqual({ Authorization: WEBHOOK_HEADER_VALUE_KEPT });
    });

    /** @scenario "Leaving a header out of an update removes it" */
    it("reads an omitted header set as no headers", () => {
      const resolved = resolveCredentialPlaceholders({
        action: TriggerAction.SEND_WEBHOOK,
        incoming: { url: "https://x.example.com" },
      });
      expect(resolved.headers).toEqual({});
    });
  });

  describe("given a save that points the automation somewhere new", () => {
    /** @scenario "Retargeting while keeping the stored header values is refused" */
    it("refuses a kept header value", () => {
      expect(() =>
        assertHeaderValuesTravelWithTheirDestination({
          action: TriggerAction.SEND_WEBHOOK,
          incoming: { url: "https://new.example.com", headers: { A: REDACTED_CREDENTIAL } },
          stored: { url: "https://old.example.com" },
        }),
      ).toThrow(expect.objectContaining({ code: "webhook_header_values_required" }));
    });

    /** @scenario "Retargeting while keeping the stored signing secret is refused" */
    it("refuses a kept signing secret, naming it", () => {
      expect(() =>
        assertHeaderValuesTravelWithTheirDestination({
          action: TriggerAction.SEND_WEBHOOK,
          incoming: { url: "https://new.example.com", signingSecret: REDACTED_CREDENTIAL },
          stored: { url: "https://old.example.com" },
        }),
      ).toThrow(expect.objectContaining({ code: "invalid_action_params" }));
    });
  });
});

describe("splitStoredRuleFromDelivery", () => {
  /** @scenario "Another channel's field never survives as part of the rule" */
  it("reads every channel's field as delivery and the rest as the rule", () => {
    const { delivery, rule } = splitStoredRuleFromDelivery({
      members: ["a@example.com"],
      slackWebhook: "https://hooks.slack.com/x",
      threshold: 5,
    });
    expect(delivery).toEqual({
      members: ["a@example.com"],
      slackWebhook: "https://hooks.slack.com/x",
    });
    expect(rule).toEqual({ threshold: 5 });
  });
});

describe("assertActionParamsFieldsAreThisChannels", () => {
  /** @scenario "A field the channel does not have is refused, not dropped" */
  it("refuses another channel's field and names what fits", () => {
    expect(() =>
      assertActionParamsFieldsAreThisChannels({
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["a@example.com"], url: "https://x.example.com" },
        kind: "AUTOMATION",
      }),
    ).toThrow(
      expect.objectContaining({ code: "trigger_action_params_unknown_fields", fields: ["url"] }),
    );
  });

  /** @scenario "A rule sent in the delivery configuration is refused" */
  it("says where an alert's rule belongs", () => {
    expect(() =>
      assertActionParamsFieldsAreThisChannels({
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["a@example.com"], threshold: 5 },
        kind: "ALERT",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "trigger_rule_fields_misplaced",
        expectedField: "graphAlert",
      }),
    );
  });
});
