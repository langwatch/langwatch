import { testFireSlackBlock, testFireSlackText } from "./banner";
import { filterBlockKit } from "./blockKitAllowlist";
import {
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage, renderWithFallback } from "./renderWithFallback";
import type {
  GraphAlertTemplateContext,
  TemplateContext,
} from "./templateContext";

/**
 * Default-template overrides for `renderTriggerSlack` (ADR-034 Phase 8.1).
 * Lets the graph-alert path render against `ALERT_TRIGGER_DEFAULTS`
 * without forking the engine; trace callers omit it and keep the
 * trace defaults (`DEFAULT_SLACK_TEMPLATE` / `DEFAULT_SLACK_BLOCK_KIT_TEMPLATE`).
 */
export interface SlackRenderDefaults {
  slackString: string;
  slackBlockKit: string;
}

export type SlackTemplateType = "string" | "block_kit";

export type SlackPayload =
  | { text: string }
  | { blocks: Record<string, unknown>[] };

export interface RenderedSlack {
  payload: SlackPayload;
  /** True when the framework default was used (custom null, threw, or unparseable Block Kit). */
  usedDefault: boolean;
  missingVariables: string[];
  errors: string[];
}

async function fallbackToDefaultText({
  context,
  testFire,
  error,
  customMissing,
  defaultSlackString,
}: {
  context: Record<string, unknown>;
  testFire: boolean;
  error: string;
  customMissing: string[] | undefined;
  defaultSlackString: string;
}): Promise<RenderedSlack> {
  const fallback = await defaultSlackText({
    context,
    testFire,
    defaultSlackString,
  });
  return {
    payload: { text: fallback.text },
    usedDefault: true,
    missingVariables: customMissing ?? fallback.missingVariables,
    errors: [error],
  };
}

function defaultSlackText({
  context,
  testFire,
  defaultSlackString,
}: {
  context: Record<string, unknown>;
  testFire: boolean;
  defaultSlackString: string;
}): Promise<{ text: string; missingVariables: string[] }> {
  return renderLiquid({ template: defaultSlackString, context }).then(
    (rendered) => ({
      text: testFire
        ? `${testFireSlackText()}\n\n${rendered.output}`
        : rendered.output,
      missingVariables: rendered.missingVariables,
    }),
  );
}

/**
 * Renders a trigger Slack message. `templateType` (not the presence of
 * `template`) decides which renderer runs — a null template paired with
 * `templateType: "block_kit"` is "use the block_kit framework default",
 * not "fall back to plain text." Block Kit templates are parsed as JSON
 * and passed through the allowlist; any failure (render throw, invalid
 * JSON, or no surviving blocks) falls back to the plain-text default. A
 * test fire prepends a non-suppressible banner.
 */
export async function renderTriggerSlack({
  templateType,
  template,
  context,
  defaults,
  testFire = false,
}: {
  templateType: SlackTemplateType | null;
  template: string | null;
  context: TemplateContext | GraphAlertTemplateContext;
  /** Per-context default overrides (ADR-034 Phase 8.1). When omitted,
   *  the trace defaults apply — same behaviour as before. */
  defaults?: SlackRenderDefaults;
  testFire?: boolean;
}): Promise<RenderedSlack> {
  const ctx = context as unknown as Record<string, unknown>;
  const slackString = defaults?.slackString ?? DEFAULT_SLACK_TEMPLATE;
  const slackBlockKit = defaults?.slackBlockKit ?? DEFAULT_SLACK_BLOCK_KIT_TEMPLATE;

  if (templateType !== "block_kit") {
    const rendered = await renderWithFallback({
      template,
      fallback: slackString,
      context: ctx,
    });
    const text = testFire
      ? `${testFireSlackText()}\n\n${rendered.output}`
      : rendered.output;
    return {
      payload: { text },
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.error ? [rendered.error] : [],
    };
  }

  const effectiveTemplate = template ?? slackBlockKit;
  const usedDefaultTemplate = template == null;
  // `customMissing` captures the missing-variable diagnostics from the
  // customer's template render. If the JSON.parse / allowlist filter
  // below throws, we still want to surface THOSE diagnostics (the
  // author's typos) rather than swap them out for the framework
  // default's. Without this the preview UI loses the actual signal the
  // author needs to fix their template.
  let customMissing: string[] | undefined;
  try {
    const rendered = await renderLiquid({
      template: effectiveTemplate,
      context: ctx,
    });
    customMissing = rendered.missingVariables;
    const parsed: unknown = JSON.parse(rendered.output);
    const blocksInput = Array.isArray(parsed)
      ? parsed
      : (parsed as { blocks?: unknown })?.blocks;
    const blocks = filterBlockKit(blocksInput);
    if (blocks.length === 0) {
      // Expected outcome (e.g. every block was filtered by the allowlist),
      // not a render failure — fall back to the plain-text default directly.
      return fallbackToDefaultText({
        context: ctx,
        testFire,
        error: "Block Kit template produced no allowed blocks",
        customMissing,
        defaultSlackString: slackString,
      });
    }
    return {
      payload: {
        blocks: testFire ? [testFireSlackBlock(), ...blocks] : blocks,
      },
      usedDefault: usedDefaultTemplate,
      missingVariables: rendered.missingVariables,
      errors: [],
    };
  } catch (err) {
    return fallbackToDefaultText({
      context: ctx,
      testFire,
      error: errorMessage(err),
      customMissing,
      defaultSlackString: slackString,
    });
  }
}
