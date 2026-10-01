import { isSameOrigin } from "@langwatch/workflow-contract";

const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The text with each `{{ secrets.NAME }}` replaced as the engine will, an unknown name left as is. */
export function withSecretValues(input: {
  text: string;
  values: Readonly<Record<string, string>>;
}): string {
  return input.text.replace(SECRET_REFERENCE, (reference, name: string) =>
    Object.hasOwn(input.values, name) ? (input.values[name] ?? reference) : reference,
  );
}

/** Whether the parts of a call the engine fills reference a secret bound to another origin
 * than the one `url`, references resolved, calls. */
export function sendsBoundSecretElsewhere(input: {
  sent: unknown;
  url: string;
  origins: Readonly<Record<string, string>>;
}): boolean {
  const text = JSON.stringify(input.sent) ?? "";

  return [...text.matchAll(SECRET_REFERENCE)].some(([, name]) => {
    const bound = name && Object.hasOwn(input.origins, name) ? input.origins[name] : undefined;

    return bound !== undefined && !isSameOrigin({ requested: input.url, saved: bound });
  });
}
