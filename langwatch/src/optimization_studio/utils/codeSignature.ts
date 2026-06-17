import type { Field } from "../types/dsl";

/** Maps a studio field type to the Python annotation used in a code signature. */
const typesMap: Record<Field["type"], string> = {
  str: "str",
  int: "int",
  float: "float",
  bool: "bool",
  image: "dspy.Image",
  list: "list",
  "list[str]": "list[str]",
  "list[float]": "list[float]",
  "list[int]": "list[int]",
  "list[bool]": "list[bool]",
  dict: "dict[str, Any]",
  json_schema: "Any",
  chat_messages: "list[dict[str, Any]]",
  signature: "dspy.Signature",
  llm: "Any",
  prompting_technique: "Any",
  dataset: "Any",
  code: "str",
};

/**
 * Rewrites a code block's entrypoint signature to match its declared inputs.
 *
 * Used wherever a code block's inputs change (the studio code node and the
 * custom code-evaluator drawer) so the `__call__` / `forward` parameter list
 * stays in sync with the wired inputs. Without this, the engine calls the
 * entrypoint with a keyword it does not accept.
 *
 * Matches either the idiomatic `__call__` or the legacy `forward`, preserving
 * whichever the code already uses, and only rewrites the signature line (the
 * body is left untouched). Every parameter defaults to `None` so an
 * unconnected input does not raise "missing a required argument" at run time.
 */
export const rewriteCodeSignature = (
  code: string,
  inputs: Array<{ identifier: string; type: string }>,
): string => {
  if (inputs.length === 0) return code;

  let next = code.replace(
    /def (__call__|forward)\([\s\S]*?\):/,
    (_match, methodName: string) =>
      `def ${methodName}(self, ${inputs
        .map(
          (i) =>
            `${i.identifier}: ${typesMap[i.type as Field["type"]] ?? "Any"} = None`,
        )
        .join(", ")}):`,
  );
  if (next.includes(": Any") && !next.includes("from typing import Any")) {
    next = `from typing import Any\n${next}`;
  }
  return next;
};
