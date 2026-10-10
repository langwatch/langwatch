import { describe, expect, it } from "vitest";

import { TEST_FIRE_EMAIL_SUBJECT_PREFIX, TEST_FIRE_NOTICE } from "../banner.ts";
import { EMAIL_SUBJECT_MAX_LENGTH, renderTriggerEmail } from "../render-email.ts";
import { makeContext, makeMatch } from "./fixtures.ts";

describe("renderTriggerEmail", () => {
  describe("when no custom templates are provided", () => {
    /** @scenario "Default email is rendered when no email templates are set" */
    it("renders the default subject naming the trigger and alert type", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("(WARNING) Trigger - High latency");
      expect(email.usedDefault).toBe(true);
    });

    // #6716 P0: the default body carries the matched trace's input and output
    // excerpt beside the link, so the notification is informative on its own.
    /** @scenario "The default trace layout includes input and output excerpts" */
    it("renders the default body with a link and the matched trace's input and output", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.html).toContain('href="https://app.langwatch.ai/acme/traces/trace_1"');
      expect(email.html).toContain("what is the weather");
      expect(email.html).toContain("it is sunny");
    });

    it("renders the chrome footer with the project + edit-automation links", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.html).toContain("Sent with");
      expect(email.html).toContain("Edit automation");
      expect(email.html).toContain('href="https://app.langwatch.ai/acme"');
      expect(email.html).toContain(
        'href="https://app.langwatch.ai/acme/automations?drawer.open=automation&amp;drawer.automationId=trg_1&amp;drawer.source=email-link"',
      );
    });

    it("renders the chrome footer regardless of what the body template prints", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "Body content only.",
        context: makeContext(),
      });
      expect(email.html).toContain("Edit automation");
    });
  });

  describe("when a custom subject template is provided", () => {
    /** @scenario "A custom subject interpolates trigger and project variables" */
    it("interpolates project and trigger variables", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "[{{ project.name }}] {{ trigger.alertType }}: {{ trigger.name }}",
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("[Acme] WARNING: High latency");
      expect(email.errors).toEqual([]);
    });
  });

  describe("when a custom body template uses Markdown", () => {
    /** @scenario "A custom email body is written in Markdown and rendered to HTML" */
    it("renders the Markdown to HTML", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "## {{ trigger.name }}\n\n[trace]({{ matches[0].trace.url }})",
        context: makeContext(),
      });
      expect(email.html).toContain("<h2>High latency</h2>");
      expect(email.html).toContain('href="https://app.langwatch.ai/acme/traces/trace_1"');
    });
  });

  describe("when the rendered subject exceeds the limit", () => {
    /** @scenario "An over-long subject is clipped" */
    it("clips it with an ellipsis", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "{{ trigger.name }}",
        bodyTemplate: null,
        context: makeContext({
          trigger: {
            id: "t",
            name: "x".repeat(300),
            alertType: null,
            editUrl: "https://app.langwatch.test/automations",
          },
        }),
      });
      expect(email.subject.length).toBe(EMAIL_SUBJECT_MAX_LENGTH);
      expect(email.subject.endsWith("…")).toBe(true);
    });
  });

  describe("when a custom body template iterates matches", () => {
    /** @scenario "The same template renders every entry for a digest dispatch" */
    it("renders one entry per match for a digest", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "{% for m in matches %}- {{ m.trace.id }}\n{% endfor %}",
        context: makeContext({
          digest: { count: 3, windowStart: null, windowEnd: null },
          matches: [
            makeMatch({
              trace: {
                id: "trace-aaa",
                input: "",
                output: "",
                url: "#",
                metadata: {},
              },
            }),
            makeMatch({
              trace: {
                id: "trace-bbb",
                input: "",
                output: "",
                url: "#",
                metadata: {},
              },
            }),
            makeMatch({
              trace: {
                id: "trace-ccc",
                input: "",
                output: "",
                url: "#",
                metadata: {},
              },
            }),
          ],
        }),
      });
      expect(email.html).toContain("<li>trace-aaa</li>");
      expect(email.html).toContain("<li>trace-bbb</li>");
      expect(email.html).toContain("<li>trace-ccc</li>");
    });
  });

  describe("when a custom body template iterates a single-match dispatch", () => {
    /** @scenario "A template iterating matches renders one entry for an immediate dispatch" */
    it("renders exactly one entry", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "{% for m in matches %}- {{ m.trace.id }}\n{% endfor %}",
        context: makeContext(),
      });
      expect(email.html.match(/<li>/g)).toHaveLength(1);
    });
  });

  describe("when a custom template throws while rendering", () => {
    /** @scenario "A template that throws falls back to the default" */
    it("falls back to the default and surfaces the error", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "{{ trigger.name | nonexistent_filter }}",
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("(WARNING) Trigger - High latency");
      expect(email.usedDefault).toBe(true);
      expect(email.errors.length).toBeGreaterThan(0);
    });
  });

  describe("when a template references a missing variable", () => {
    /** @scenario "A missing variable renders empty rather than failing" */
    it("renders empty for it and reports the full path", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "{{ trigger.name }}{{ projct.name }}",
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("High latency");
      expect(email.missingVariables).toContain("projct.name");
    });
  });

  describe("when dispatched as a test fire", () => {
    /** @scenario "Test-fire email carries a non-suppressible banner" */
    it("prefixes the subject and prepends a body banner", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
        testFire: true,
      });
      expect(email.subject.startsWith(TEST_FIRE_EMAIL_SUBJECT_PREFIX)).toBe(true);
      expect(email.html).toContain(TEST_FIRE_NOTICE);
    });
  });
});
