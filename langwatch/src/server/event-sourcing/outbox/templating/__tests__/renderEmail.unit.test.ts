import { describe, expect, it } from "vitest";
import { TEST_FIRE_EMAIL_SUBJECT_PREFIX, TEST_FIRE_NOTICE } from "../banner";
import { EMAIL_SUBJECT_MAX_LENGTH, renderTriggerEmail } from "../renderEmail";
import { makeContext, makeMatch } from "./fixtures";

describe("renderTriggerEmail", () => {
  describe("when no custom templates are provided", () => {
    it("renders the default subject naming the trigger and alert type", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("(WARNING) Trigger - High latency");
      expect(email.usedDefault).toBe(true);
    });

    it("renders the default body with a link per match", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.html).toContain(
        'href="https://app.langwatch.ai/acme/messages/trace_1"',
      );
    });
  });

  describe("when a custom subject template is provided", () => {
    it("interpolates project and trigger variables", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate:
          "[{{ project.name }}] {{ trigger.alertType }}: {{ trigger.name }}",
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("[Acme] WARNING: High latency");
      expect(email.errors).toEqual([]);
    });
  });

  describe("when a custom body template uses Markdown", () => {
    it("renders the Markdown to HTML", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "## {{ trigger.name }}\n\n[trace]({{ matches[0].trace.url }})",
        context: makeContext(),
      });
      expect(email.html).toContain("<h2>High latency</h2>");
      expect(email.html).toContain(
        'href="https://app.langwatch.ai/acme/messages/trace_1"',
      );
    });
  });

  describe("when the rendered subject exceeds the limit", () => {
    it("clips it with an ellipsis", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "{{ trigger.name }}",
        bodyTemplate: null,
        context: makeContext({
          trigger: {
            id: "t",
            name: "x".repeat(300),
            message: "",
            alertType: null,
          },
        }),
      });
      expect(email.subject.length).toBe(EMAIL_SUBJECT_MAX_LENGTH);
      expect(email.subject.endsWith("…")).toBe(true);
    });
  });

  describe("when a custom body template iterates matches", () => {
    it("renders one entry per match for a digest", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: null,
        bodyTemplate: "{% for m in matches %}- {{ m.trace.id }}\n{% endfor %}",
        context: makeContext({
          digest: { count: 3, windowStart: null, windowEnd: null },
          matches: [
            makeMatch({ trace: { id: "trace-aaa", input: "", output: "", url: "#", metadata: {}, label: "trace-aaa", isCustomGraph: false } }),
            makeMatch({ trace: { id: "trace-bbb", input: "", output: "", url: "#", metadata: {}, label: "trace-bbb", isCustomGraph: false } }),
            makeMatch({ trace: { id: "trace-ccc", input: "", output: "", url: "#", metadata: {}, label: "trace-ccc", isCustomGraph: false } }),
          ],
        }),
      });
      expect(email.html).toContain("<li>trace-aaa</li>");
      expect(email.html).toContain("<li>trace-bbb</li>");
      expect(email.html).toContain("<li>trace-ccc</li>");
    });
  });

  describe("when a custom template throws while rendering", () => {
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
    it("renders empty for it and reports the name", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "{{ trigger.name }}{{ projct.name }}",
        bodyTemplate: null,
        context: makeContext(),
      });
      expect(email.subject).toBe("High latency");
      expect(email.missingVariables).toContain("projct");
    });
  });

  describe("when dispatched as a test fire", () => {
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

    it("clips the final subject including the prefix to the cap", async () => {
      const email = await renderTriggerEmail({
        subjectTemplate: "X".repeat(300),
        bodyTemplate: null,
        context: makeContext(),
        testFire: true,
      });
      expect(email.subject.length).toBe(EMAIL_SUBJECT_MAX_LENGTH);
      expect(email.subject.startsWith(TEST_FIRE_EMAIL_SUBJECT_PREFIX)).toBe(true);
      expect(email.subject.endsWith("…")).toBe(true);
    });
  });
});
