import type { WebhookBodyFormat } from "../providers/webhook";
import { DEFAULT_WEBHOOK_BODY_TEMPLATE } from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  ReportTemplateContext,
  TemplateContext,
} from "./templateContext";

export interface RenderedWebhookBody {
  /** The string to send: valid JSON for a `json` body, the render output
   *  verbatim for a `text` one. */
  body: string;
  /** True when the framework default was used (custom null, threw, or
   *  unparseable). Always false for a `text` body, which has no default. */
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
 * A plain-text body: whatever the template rendered, byte for byte.
 *
 * There is no parse to validate against and no framework default to fall back
 * to — a JSON envelope is exactly what an endpoint that asked for text cannot
 * read, and re-sending the unrendered template would post `{{ trigger.name }}`
 * as if it were content. A render failure therefore degrades to an EMPTY body,
 * carrying the same diagnostics the JSON path records, so the author sees what
 * broke and the receiver sees nothing it has to guess at.
 */
async function renderTextBody({
  template,
  context,
}: {
  template: string | null;
  context: Record<string, unknown>;
}): Promise<RenderedWebhookBody> {
  if (template == null || template.trim() === "") {
    return { body: "", usedDefault: false, missingVariables: [], errors: [] };
  }
  try {
    const rendered = await renderLiquid({ template, context });
    return {
      body: rendered.output,
      usedDefault: false,
      missingVariables: rendered.missingVariables,
      errors: [],
    };
  } catch (err) {
    return {
      body: "",
      usedDefault: false,
      missingVariables: [],
      errors: [errorMessage(err)],
    };
  }
}

/**
 * Renders a webhook automation's body (ADR-040 §2) — the same Liquid engine and
 * contexts Slack/email render against.
 *
 * A `json` body keeps the Block Kit fall-back discipline: the output must
 * `JSON.parse`, and a render throw or parse failure on the customer's template
 * falls back to the framework default body, with the error captured for the
 * operator. If even the default fails (it shouldn't — it is ours), a minimal
 * static envelope is sent rather than nothing, so a delivery is never silently
 * dropped over a template.
 *
 * A `text` body has no shape to validate and no default to fall back to; see
 * {@link renderTextBody}.
 */
export async function renderWebhookBody({
  template,
  context,
  format = "json",
  defaultBody = DEFAULT_WEBHOOK_BODY_TEMPLATE,
}: {
  /** The customer's Liquid template, or null for the framework default. */
  template: string | null;
  context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext;
  /** What the body is (`actionParams.bodyFormat`). Absent means JSON. */
  format?: WebhookBodyFormat;
  /** Per-source default override (`defaultsForSourceKind(...).webhookBody`).
   *  Only a JSON body has one. */
  defaultBody?: string;
}): Promise<RenderedWebhookBody> {
  const ctx = context as unknown as Record<string, unknown>;

  if (format === "text") return renderTextBody({ template, context: ctx });

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
