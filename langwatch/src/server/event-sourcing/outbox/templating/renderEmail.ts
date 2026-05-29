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
import type { TemplateContext } from "./templateContext";

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
 */
export async function renderTriggerEmail({
  subjectTemplate,
  bodyTemplate,
  context,
  testFire = false,
}: {
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  context: TemplateContext;
  testFire?: boolean;
}): Promise<RenderedEmail> {
  const ctx = context as unknown as Record<string, unknown>;

  const subjectRender = await renderWithFallback({
    template: subjectTemplate,
    fallback: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
    context: ctx,
  });
  const bodyRender = await renderWithFallback({
    template: bodyTemplate,
    fallback: DEFAULT_EMAIL_BODY_TEMPLATE,
    context: ctx,
  });

  const clipped = clipSubject(subjectRender.output);
  const subject = testFire
    ? `${TEST_FIRE_EMAIL_SUBJECT_PREFIX}${clipped}`
    : clipped;

  const html = wrapEmailHtml({
    bodyHtml: markdownToEmailHtml(bodyRender.output),
    prefixHtml: testFire ? testFireEmailCalloutHtml() : "",
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
