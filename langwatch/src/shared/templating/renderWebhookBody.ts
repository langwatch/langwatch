import { DEFAULT_WEBHOOK_BODY_TEMPLATE } from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  ReportTemplateContext,
  TemplateContext,
} from "./templateContext";

export interface RenderedWebhookBody {
  /** The JSON string to send. Empty when a custom template failed to render
   *  (`failed: true`); callers MUST NOT dispatch it. */
  body: string;
  /** True when the framework default envelope was used (the custom template was
   *  absent). Never true as a fallback for a broken custom template. */
  usedDefault: boolean;
  /** True when a NON-EMPTY custom template threw or produced invalid JSON. The
   *  caller must fail the dispatch rather than fall back — falling back would
   *  leak the full-trace default the customer intentionally omitted (ADR-040
   *  §2, fail closed). */
  failed: boolean;
  missingVariables: string[];
  errors: string[];
}

async function renderJsonBody({
  template,
  context,
}: {
  template: string;
  context: Record<string, unknown>;
}): Promise<{ body: string; missingVariables: string[] }> {
  const rendered = await renderLiquid({ template, context });
  // Parse-then-reserialize: validates the render produced JSON and
  // normalizes the whitespace the Liquid control flow leaves behind.
  const parsed: unknown = JSON.parse(rendered.output);
  return {
    body: JSON.stringify(parsed),
    missingVariables: rendered.missingVariables,
  };
}

/**
 * Renders a webhook automation's JSON body (ADR-040 §2) — the same Liquid
 * engine and contexts Slack/email render against, but fail CLOSED: a non-empty
 * custom template that throws or produces invalid JSON returns a render failure
 * (`failed: true`, empty body), NEVER the framework default. Falling back would
 * disclose the full-trace default body the customer intentionally left out of
 * their payload — a data leak, not a convenience. Callers must reject a failed
 * render before dispatching.
 *
 * The framework default is used ONLY when no custom template is supplied. If
 * even the default fails (it is ours, so that is a framework bug), a minimal
 * static envelope is returned so a default-body delivery is never silently
 * dropped over a template.
 */
export async function renderWebhookBody({
  template,
  context,
  defaultBody = DEFAULT_WEBHOOK_BODY_TEMPLATE,
}: {
  /** The customer's Liquid JSON template, or null for the framework default. */
  template: string | null;
  context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext;
  /** Per-source default override (`defaultsForSourceKind(...).webhookBody`). */
  defaultBody?: string;
}): Promise<RenderedWebhookBody> {
  const ctx = context as unknown as Record<string, unknown>;

  if (template != null && template.trim() !== "") {
    try {
      const rendered = await renderLiquid({ template, context: ctx });
      const parsed: unknown = JSON.parse(rendered.output);
      return {
        body: JSON.stringify(parsed),
        usedDefault: false,
        failed: false,
        missingVariables: rendered.missingVariables,
        errors: [],
      };
    } catch (err) {
      return {
        body: "",
        usedDefault: false,
        failed: true,
        missingVariables: [],
        errors: [errorMessage(err)],
      };
    }
  }

  try {
    const rendered = await renderJsonBody({
      template: defaultBody,
      context: ctx,
    });
    return {
      body: rendered.body,
      usedDefault: true,
      failed: false,
      missingVariables: rendered.missingVariables,
      errors: [],
    };
  } catch (err) {
    const trigger = ctx.trigger as { id?: string; name?: string } | undefined;
    return {
      body: JSON.stringify({
        event: "trigger.fired",
        trigger: { id: trigger?.id ?? null, name: trigger?.name ?? null },
      }),
      usedDefault: true,
      failed: false,
      missingVariables: [],
      errors: [errorMessage(err)],
    };
  }
}
