// Shapes shared by the two toaster rules: a failure-typed toast object, and a module's role.

const TRANSPARENT = new Set(["TSAsExpression", "TSSatisfiesExpression", "ParenthesizedExpression"]);

function unwrap(node) {
  let current = node;
  while (current && TRANSPARENT.has(current.type)) current = current.expression;

  return current;
}

/** `type: "error"`, with or without the `as const` a builder writes. */
export function isErrorToastType(property) {
  if (property.type !== "Property" || property.computed) return false;
  const key = property.key;
  const name = key?.type === "Identifier" ? key.name : key?.value;
  const value = unwrap(property.value);

  return name === "type" && value?.type === "Literal" && value.value === "error";
}

/** A feature-web module: `modules/<name>/browser`, at either level. Tests are not governed. */
export function isFeatureWebCode(file) {
  return !file.isTest && /(?:^|\/)modules\/[^/]+\/browser\//.test(file.workspacePath);
}
