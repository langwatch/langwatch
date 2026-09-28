import {
  DEFAULT_WEBHOOK_CONTENT_TYPE,
  isJsonWebhookContentType,
} from "../providers/webhook";
import { DEFAULT_WEBHOOK_BODY_TEMPLATE } from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  ReportTemplateContext,
  TemplateContext,
} from "./templateContext";

export interface RenderedWebhookBody {
  /** The string to send: valid JSON for a JSON content type, the render
   *  output verbatim for any other. */
  body: string;
  /** True when the framework default was used (custom null, threw, or
   *  unparseable). Always false for a non-JSON body, which has no default. */
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

/** A non-JSON body: the render output byte for byte. There is no default to
 *  fall back to (a JSON envelope is what such an endpoint cannot read), so a
 *  render failure sends an EMPTY body and keeps the diagnostics. */
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
  /** The declared `Content-Type` (`actionParams.contentType`). Absent means
   *  JSON. */
  contentType?: string;
  /** Per-source default override (`defaultsForSourceKind(...).webhookBody`).
   *  Only a JSON body has one. */
  defaultBody?: string;
}): Promise<RenderedWebhookBody> {
  const ctx = context as unknown as Record<string, unknown>;

  if (!isJsonWebhookContentType(contentType)) {
    return renderTextBody({ template, context: ctx });
  }

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
