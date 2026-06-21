import {
  TEST_FIRE_EMAIL_SUBJECT_PREFIX,
  testFireEmailCalloutHtml,
} from "./banner";
import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
} from "./defaults";
import { wrapEmailHtml } from "./emailLayout";
import { markdownToEmailHtml } from "./markdown";
import { renderWithFallback } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  TemplateContext,
} from "./templateContext";

export const EMAIL_SUBJECT_MAX_LENGTH = 200;

export interface RenderedEmail {
  subject: string;
  html: string;
  /** True when either subject or body fell back to the framework default. */
  usedDefault: boolean;
  missingVariables: string[];
  /** Render errors from custom templates that fell back, for operator visibility. */
  errors: string[];
}

function clipSubject(subject: string): string {
  const oneLine = subject.replace(/\s+/g, " ").trim();
  if (oneLine.length <= EMAIL_SUBJECT_MAX_LENGTH) return oneLine;
  return `${oneLine.slice(0, EMAIL_SUBJECT_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Renders a trigger email from optional customer templates, falling back to the
 * framework default per part. Body is Liquid → Markdown → sanitized HTML →
 * LangWatch frame. On a test fire, a non-suppressible banner is injected by the
 * backend (subject prefix + body callout) above the customer content.
 *
 * `defaults` (optional) overrides the framework subject/body templates the
 * renderer falls back to. ADR-034 Phase 8.1 uses this to render
 * `GraphAlertTemplateContext` against the alert-default templates without
 * forking the engine; trace callers omit it and keep the trace defaults.
 * Both `TemplateContext` and `GraphAlertTemplateContext` carry the
 * `project.url` + `trigger.editUrl` the chrome footer needs, so the
 * non-template chrome wrap works for either.
 */
export async function renderTriggerEmail({
  subjectTemplate,
  bodyTemplate,
  context,
  defaults,
  testFire = false,
}: {
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  context: TemplateContext | GraphAlertTemplateContext;
  defaults?: { emailSubject: string; emailBody: string };
  testFire?: boolean;
}): Promise<RenderedEmail> {
  const ctx = context as unknown as Record<string, unknown>;

  const subjectRender = await renderWithFallback({
    template: subjectTemplate,
    fallback: defaults?.emailSubject ?? DEFAULT_EMAIL_SUBJECT_TEMPLATE,
    context: ctx,
  });
  const bodyRender = await renderWithFallback({
    template: bodyTemplate,
    fallback: defaults?.emailBody ?? DEFAULT_EMAIL_BODY_TEMPLATE,
    context: ctx,
  });

  // Clip AFTER the test-fire prefix is prepended so the final subject
  // respects EMAIL_SUBJECT_MAX_LENGTH end-to-end. Clipping the rendered
  // subject first and then prepending the prefix means a near-max
  // template + prefix exceeds the cap a downstream mailer might bounce
  // on, and any test-fire-mode mail client display also runs over.
  const subject = clipSubject(
    testFire
      ? `${TEST_FIRE_EMAIL_SUBJECT_PREFIX}${subjectRender.output}`
      : subjectRender.output,
  );

  const html = wrapEmailHtml({
    bodyHtml: markdownToEmailHtml(bodyRender.output),
    prefixHtml: testFire ? testFireEmailCalloutHtml() : "",
    footer: {
      projectUrl: context.project.url,
      editUrl: context.trigger.editUrl,
    },
  });

  const errors = [subjectRender.error, bodyRender.error].filter(
    (error): error is string => error != null,
  );

  return {
    subject,
    html,
    usedDefault: subjectRender.usedDefault || bodyRender.usedDefault,
    missingVariables: [
      ...new Set([
        ...subjectRender.missingVariables,
        ...bodyRender.missingVariables,
      ]),
    ],
    errors,
  };
}
