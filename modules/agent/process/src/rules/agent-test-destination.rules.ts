const SECRET_REFERENCE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The text with each `{{ secrets.NAME }}` replaced as the engine will, an unknown name
 * left as is. */
export function withSecretValues(input: {
  text: string;
  values: Readonly<Record<string, string>>;
}): string {
  return input.text.replace(SECRET_REFERENCE, (reference, name: string) =>
    Object.hasOwn(input.values, name) ? (input.values[name] ?? reference) : reference,
  );
}

/** Only the values the references in `referencing` name; every other secret stays unsent. */
export function referencedSecretValues(input: {
  referencing: unknown;
  values: Readonly<Record<string, string>>;
}): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [, name] of (JSON.stringify(input.referencing) ?? "").matchAll(SECRET_REFERENCE)) {
    if (name !== undefined && Object.hasOwn(input.values, name)) picked[name] = input.values[name];
  }

  return picked;
}
