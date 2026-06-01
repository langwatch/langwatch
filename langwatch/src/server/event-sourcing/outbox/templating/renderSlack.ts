import { testFireSlackBlock, testFireSlackText } from "./banner";
import { filterBlockKit } from "./blockKitAllowlist";
import { DEFAULT_SLACK_TEMPLATE } from "./defaults";
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
 * Renders a trigger Slack message. `block_kit` templates are parsed as JSON and
 * passed through the allowlist; any failure (render throw, invalid JSON, or no
 * surviving blocks) falls back to the default plain-text message. A test fire
 * prepends a non-suppressible banner.
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

  // Custom template supplied without an explicit type → operator error.
  // We refuse to guess whether the body is plain text or Block Kit JSON
  // because either choice silently mis-renders the other (treating a JSON
  // doc as text leaks braces into Slack; treating plain text as Block Kit
  // crashes JSON.parse). Fall back to the default and surface the issue.
  if (template != null && templateType == null) {
    const fallback = await defaultSlackText({ context: ctx, testFire });
    return {
      payload: { text: fallback.text },
      usedDefault: true,
      missingVariables: fallback.missingVariables,
      errors: [
        'Slack template was provided without a templateType — set "string" or "block_kit" to disambiguate.',
      ],
    };
  }

  if (template == null || templateType === "string") {
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

  try {
    const rendered = await renderLiquid({ template, context: ctx });
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
      usedDefault: false,
      missingVariables: rendered.missingVariables,
      errors: [],
    };
  } catch (err) {
    const fallback = await defaultSlackText({ context: ctx, testFire });
    return {
      payload: { text: fallback.text },
      usedDefault: true,
      missingVariables: fallback.missingVariables,
      errors: [errorMessage(err)],
    };
  }
}
