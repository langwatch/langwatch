/**
 * Test-fire banner. When a notification is dispatched via the "Test fire" UI
 * button (not a real match), the backend injects a non-suppressible marker so
 * recipients can't mistake it for a real alert. The banner is backend-injected
 * and NOT template-controllable (see ADR-024).
 */

export const TEST_FIRE_NOTICE =
  "TEST FIRE — sent by the trigger test button, not by a real match.";

export const TEST_FIRE_EMAIL_SUBJECT_PREFIX = "[TEST] ";

export function testFireEmailCalloutHtml(): string {
  return `<div style="background-color:#FFF8E1;border:1px solid #FFE082;border-radius:6px;padding:12px 16px;margin:16px 0;color:#7A5B00;font-weight:bold;">${TEST_FIRE_NOTICE}</div>`;
}

export function testFireSlackText(): string {
  return `*${TEST_FIRE_NOTICE}*`;
}

export function testFireSlackBlock(): Record<string, unknown> {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${TEST_FIRE_NOTICE}*`,
    },
  };
}
