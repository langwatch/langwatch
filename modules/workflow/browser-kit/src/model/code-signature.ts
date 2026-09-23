import type { Field } from "@langwatch/workflow-contract";

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

/** Rewrite entrypoint signature to match declared inputs (__call__/__forward in sync). */
export const rewriteCodeSignature = (
  code: string,
  inputs: { identifier: string; type: string }[],
): string => {
  if (inputs.length === 0) return code;

  let next = code.replace(
    /def (__call__|forward)\([\s\S]*?\)(\s*->\s*[^:\n]+)?:/,
    (_match, methodName: string, returnType: string | undefined) =>
      `def ${methodName}(self, ${inputs
        .map((i) => `${i.identifier}: ${typesMap[i.type as Field["type"]] ?? "Any"} = None`)
        .join(", ")})${returnType ?? ""}:`,
  );
  const usesAnyType = next.includes(": Any");
  const importsAnyType = next.includes("from typing import Any");
  if (usesAnyType && !importsAnyType) {
    next = `from typing import Any\n${next}`;
  }
  return next;
};
