// What the web-state rules share (dev/docs/ARCHITECTURE.md, browser state tiers):
// which files are browser code, and how to read a hook call and a useState pair.

const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

export function isFunction(node) {
  return Boolean(node) && FUNCTION_TYPES.has(node.type);
}

/** Browser packages, kits and the UI app; tests are never governed. */
export function isBrowserCode(file) {
  if (file.isTest) return false;
  if (file.role === "browser" || file.role === "browser-kit") return true;

  return file.kind === "application" && file.workspacePath.startsWith("apps/ui/");
}

/** `useX(...)` and `React.useX(...)` both answer "useX". */
export function hookNameOf(call) {
  const callee = call.callee;
  if (callee?.type === "Identifier") return callee.name;
  if (callee?.type === "MemberExpression" && !callee.computed) return callee.property?.name;

  return undefined;
}

/** Records `setX` when the declarator is `const [x, setX] = useState(...)`. */
export function collectSetter({ declarator, setters }) {
  const { id, init } = declarator;
  if (id?.type !== "ArrayPattern" || init?.type !== "CallExpression") return;
  if (hookNameOf(init) !== "useState") return;
  const setter = id.elements?.[1];
  if (setter?.type === "Identifier") setters.add(setter.name);
}

/** `useState` setters per enclosing function: a prop of the same name is not one. */
export function createSetterScopes() {
  const scopes = [];
  const enter = () => void scopes.push(new Set());
  const exit = () => void scopes.pop();

  return {
    visitors: {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
    },
    collect(declarator) {
      if (scopes.length > 0) collectSetter({ declarator, setters: scopes.at(-1) });
    },
    has: (name) => scopes.some((scope) => scope.has(name)),
  };
}

/** `(prev) => ...` reads the previous state: accumulation, not a copy of its argument. */
export function isUpdaterReadingPrevious(argument) {
  return isFunction(argument) && argument.params.length > 0;
}
