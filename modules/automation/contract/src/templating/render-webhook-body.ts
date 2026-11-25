import { DEFAULT_WEBHOOK_CONTENT_TYPE, isJsonWebhookContentType } from "../providers/webhook.ts";
import { DEFAULT_WEBHOOK_BODY_TEMPLATE } from "./defaults.ts";
import { renderLiquid } from "./engine.ts";
import { errorMessage } from "./render-with-fallback.ts";
import type {
  GraphAlertTemplateContext,
  ReportTemplateContext,
  TemplateContext,
} from "./template-context.ts";

export interface RenderedWebhookBody {
  /** The string to send: valid JSON for a JSON content type, else the render output verbatim. */
  body: string;
  /** True when the framework default was used; always false for a non-JSON body, which has none. */
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

async function renderJsonBody({
  template,
  context,
}: {
  template: string;
  context: object;
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

/** A non-JSON body: the render output byte for byte. There is no default to
 *  fall back to (a JSON envelope is what such an endpoint cannot read), so a
 *  render failure sends an EMPTY body and keeps the diagnostics. */
async function renderTextBody({
  template,
  context,
}: {
  template: string | null;
  context: object;
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
    return { body: "", usedDefault: false, missingVariables: [], errors: [errorMessage(err)] };
  }
}

/** Renders a webhook automation's body (ADR-040 §2). A JSON type must parse:
 *  a failing custom template falls back to the default body, and a failing
 *  default to a minimal static envelope, so no delivery is dropped over a
 *  template. Any other type goes through {@link renderTextBody}. */
export async function renderWebhookBody({
  template,
  context,
  contentType = DEFAULT_WEBHOOK_CONTENT_TYPE,
  defaultBody = DEFAULT_WEBHOOK_BODY_TEMPLATE,
}: {
  /** The customer's Liquid template, or null for the framework default. */
  template: string | null;
  context: TemplateContext | GraphAlertTemplateContext | ReportTemplateContext;
  /** The declared `Content-Type` (`actionParams.contentType`); absent means JSON. */
  contentType?: string;
  /** Per-source default override (`defaultsForSourceKind(...).webhookBody`); JSON bodies only. */
  defaultBody?: string;
}): Promise<RenderedWebhookBody> {
  if (!isJsonWebhookContentType(contentType)) {
    return renderTextBody({ template, context });
  }

  // `customMissing` captures the missing-variable diagnostics from the
  // customer's own render, so a JSON.parse failure below still surfaces the
  // author's typos rather than the framework default's (clean) diagnostics.
  let customError: string | undefined;
  let customMissing: string[] | undefined;
  if (template != null && template.trim() !== "") {
    try {
      const rendered = await renderLiquid({ template, context });
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
      context,
    });
    return {
      body: rendered.body,
      usedDefault: true,
      missingVariables: customMissing ?? rendered.missingVariables,
      errors: customError ? [customError] : [],
    };
  } catch (err) {
    const trigger = context.trigger;
    return {
      body: JSON.stringify({
        event: "trigger.fired",
        trigger: { id: trigger?.id ?? null, name: trigger?.name ?? null },
      }),
      usedDefault: true,
      missingVariables: [],
      errors: [customError, errorMessage(err)].filter((e): e is string => e != null),
    };
  }
}
