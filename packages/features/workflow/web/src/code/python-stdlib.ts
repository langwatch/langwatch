import { PYTHON_BUILTINS } from "./python-builtins.catalogue";
import { PYTHON_STDLIB_MODULES } from "./python-stdlib.catalogue";

export type { PyMember, PyModule } from "./python-api.types";
export { PYTHON_BUILTINS, PYTHON_STDLIB_MODULES };

export const PYTHON_STDLIB_MODULE_NAMES: string[] = PYTHON_STDLIB_MODULES.map(
  (module) => module.name,
);

export const PYTHON_STDLIB_MODULE_BY_NAME = new Map(
  PYTHON_STDLIB_MODULES.map((module) => [module.name, module]),
);

export const PYTHON_BUILTIN_BY_NAME = new Map(
  PYTHON_BUILTINS.map((builtin) => [builtin.name, builtin]),
);

export const PYTHON_KEYWORDS: string[] = [
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
];
