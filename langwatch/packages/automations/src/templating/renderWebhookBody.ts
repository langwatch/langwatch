import { DEFAULT_WEBHOOK_BODY_TEMPLATE } from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  ReportTemplateContext,
  TemplateContext,
} from "./templateContext";

export interface RenderedWebhookBody {
  /** The JSON string to send — always valid JSON. */
  body: string;
  /** True when the framework default was used (custom null, threw, or unparseable). */
  usedDefault: boolean;
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
 * engine and contexts Slack/email render against, with the Block Kit
 * fall-back discipline: the output must `JSON.parse`, and a render throw or
 * parse failure on the customer's template falls back to the framework
 * default body, with the error captured for the operator. If even the
 * default fails (it shouldn't — it is ours), a minimal static envelope is
 * sent rather than nothing, so a delivery is never silently dropped over a
 * template.
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

  // `customMissing` captures the missing-variable diagnostics from the
  // customer's own render, so a JSON.parse failure below still surfaces the
  // author's typos rather than the framework default's (clean) diagnostics.
  let customError: string | undefined;
  let customMissing: string[] | undefined;
  if (template != null && template.trim() !== "") {
    try {
      const rendered = await renderLiquid({ template, context: ctx });
      customMissing = rendered.missingVariables;
      const parsed: unknown = JSON.parse(rendered.output);
      return {
        body: JSON.stringify(parsed),
        usedDefault: false,
        missingVariables: rendered.missingVariables,
        errors: [],
      };
    } catch (err) {
      customError = errorMessage(err);
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
      missingVariables: customMissing ?? rendered.missingVariables,
      errors: customError ? [customError] : [],
    };
  } catch (err) {
    const trigger = ctx.trigger as { id?: string; name?: string } | undefined;
    return {
      body: JSON.stringify({
        event: "trigger.fired",
        trigger: { id: trigger?.id ?? null, name: trigger?.name ?? null },
      }),
      usedDefault: true,
      missingVariables: [],
      errors: [customError, errorMessage(err)].filter(
        (e): e is string => e != null,
      ),
    };
  }
}
