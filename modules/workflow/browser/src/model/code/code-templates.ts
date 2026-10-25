import type { Field } from "@langwatch/workflow-contract";

import { type CodeLanguage, codeLanguageOf, isEcmaScript } from "../code-language.ts";
import { rewriteCodeSignature, rewriteJavaScriptSignature } from "../code-signature.ts";

type NamedField = { identifier: string; type: string };

/** The code a new code node starts with, named after its first input and output. */
export function codeTemplate({
  language,
  input = "input",
  output = "output",
}: {
  language: CodeLanguage;
  input?: string;
  output?: string;
}): string {
  if (language === "python") {
    return `class Code:
    def __call__(self, ${input}: str = None):
        # Your code goes here

        return {"${output}": "Hello world!"}
`;
  }
  const signature =
    language === "typescript"
      ? `export default async function ({ ${input} }: Inputs): Promise<Outputs> {`
      : `/**
 * @param {Inputs} inputs
 * @returns {Promise<Outputs>}
 */
export default async function ({ ${input} }) {`;
  return `${signature}
  // Your code goes here

  return { ${output}: "Hello world!" };
}
`;
}

/** The template as the node's inputs would have rewritten it: what an untouched node holds. */
function untouchedCode({
  language,
  inputs,
  outputs,
}: {
  language: CodeLanguage;
  inputs: readonly NamedField[];
  outputs: readonly NamedField[];
}): string {
  const code = codeTemplate({
    language,
    input: inputs[0]?.identifier,
    output: outputs[0]?.identifier,
  });
  return isEcmaScript({ language })
    ? rewriteJavaScriptSignature({ code, inputs })
    : rewriteCodeSignature(code, [...inputs]);
}

/**
 * Switches a code node's language. Code still as the template left it becomes the new
 * language's template; anything the author wrote is kept as it is, for them to port.
 */
export function switchCodeLanguage({
  parameters,
  inputs,
  outputs,
  to,
}: {
  parameters: readonly Field[];
  inputs: readonly NamedField[];
  outputs: readonly NamedField[];
  to: CodeLanguage;
}): Field[] {
  const from = codeLanguageOf({ parameters });
  const code = parameters.find((p) => p.identifier === "code")?.value;
  const untouched =
    typeof code !== "string" ||
    code.trim() === "" ||
    code === untouchedCode({ language: from, inputs, outputs });
  const nextCode = untouched ? untouchedCode({ language: to, inputs, outputs }) : code;
  const rest = parameters.filter((p) => p.identifier !== "language" && p.identifier !== "code");
  return [
    { identifier: "language", type: "str", value: to },
    { identifier: "code", type: "code", value: nextCode },
    ...rest,
  ];
}
