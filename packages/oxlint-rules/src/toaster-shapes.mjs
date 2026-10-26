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

// The two packages that implement the toaster: browser-host answers the feedback port and the
// design system renders the toasts, so each raises a failure toast by design.
const TOASTER_OWNERS = /^packages\/(?:browser-host|design-system)\//;

/**
 * Code the toaster rules govern: a feature-web module (`modules/<name>/browser`, at either level),
 * the app shell (`apps/ui`) and every package but the toaster's owners. Tests are not governed.
 */
export function isToasterGovernedCode(file) {
  if (file.isTest) return false;
  const path = file.workspacePath;
  if (/(?:^|\/)modules\/[^/]+\/browser\//.test(path) || path.startsWith("apps/ui/")) return true;

  return path.startsWith("packages/") && !TOASTER_OWNERS.test(path);
}
