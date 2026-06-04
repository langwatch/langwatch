import { testFireSlackBlock, testFireSlackText } from "./banner";
import { filterBlockKit } from "./blockKitAllowlist";
import {
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "./defaults";
import { renderLiquid } from "./engine";
import { errorMessage, renderWithFallback } from "./renderWithFallback";
import type { TemplateContext } from "./templateContext";

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

function defaultSlackText({
  context,
  testFire,
}: {
  context: Record<string, unknown>;
  testFire: boolean;
}): Promise<{ text: string; missingVariables: string[] }> {
  return renderLiquid({ template: DEFAULT_SLACK_TEMPLATE, context }).then(
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
  testFire = false,
}: {
  templateType: SlackTemplateType | null;
  template: string | null;
  context: TemplateContext;
  testFire?: boolean;
}): Promise<RenderedSlack> {
  const ctx = context as unknown as Record<string, unknown>;

  if (templateType !== "block_kit") {
    const rendered = await renderWithFallback({
      template,
      fallback: DEFAULT_SLACK_TEMPLATE,
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

  const effectiveTemplate = template ?? DEFAULT_SLACK_BLOCK_KIT_TEMPLATE;
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
      throw new Error("Block Kit template produced no allowed blocks");
    }
    return {
      payload: { blocks: testFire ? [testFireSlackBlock(), ...blocks] : blocks },
      usedDefault: usedDefaultTemplate,
      missingVariables: rendered.missingVariables,
      errors: [],
    };
  } catch (err) {
    const fallback = await defaultSlackText({ context: ctx, testFire });
    return {
      payload: { text: fallback.text },
      usedDefault: true,
      missingVariables: customMissing ?? fallback.missingVariables,
      errors: [errorMessage(err)],
    };
  }
}
