import { Liquid } from "liquidjs";

const liquid = new Liquid();

type RuntimeVariable = {
  identifier: string;
  value?: unknown;
};

/**
 * Renders the instruction template with the same Liquid syntax used by prompt
 * execution. The latest conversation input fills an otherwise-empty `input`
 * value, matching the playground execution boundary.
 */
export function renderPromptInstructions({
  template,
  variables,
  latestInput,
}: {
  template: string;
  variables: RuntimeVariable[];
  latestInput?: string;
}): string {
  const context = Object.fromEntries(
    variables
      .filter(({ identifier }) => identifier.length > 0)
      .map(({ identifier, value }) => [identifier, value ?? ""]),
  );

  if (latestInput !== undefined && !context.input) {
    context.input = latestInput;
  }

  try {
    return liquid.parseAndRenderSync(template, context);
  } catch {
    // The editor owns validation. A half-written Liquid tag should not make
    // the whole conversation disappear while the person is still typing it.
    return template;
  }
}
