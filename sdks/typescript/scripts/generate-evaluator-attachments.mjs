// Copies modules/scenario/contract/src/evaluator-attachments.ts into the SDK's
// generated types, with its one non-relative type import replaced by local
// declarations.
//
// Why a replacement rather than a plain `cp`: the contract module names types
// that live outside it, and the CLI can resolve neither. It has no React tree,
// and it has no workspace dependency on @langwatch/workflow-contract — the
// published tarball and all five release binaries are built from this copy, so
// an unresolvable import here ships broken generated code.
//
// Two spellings are accepted because the contract is mid-change. It used to
// import the two picker shapes from the component that draws them; it now
// declares them itself, in terms of the workflow contract's ComponentType and
// Field. Whichever it carries, the unions are widened to `string` in this copy
// — the shape it has always had. Delete the branch that stops matching once
// the contract settles.

import fs from "node:fs";

const SOURCE = "../../modules/scenario/contract/src/evaluator-attachments.ts";
const OUTPUT = "src/internal/generated/types/evaluator-attachments.ts";

const variants = [
  {
    // Current: the contract declares AvailableSource/NestedField itself and
    // reads the two underlying unions from the workflow contract.
    what: 'the workflow-contract type import ("@langwatch/workflow-contract")',
    pattern:
      /import type \{\s*ComponentType,\s*Field,?\s*\} from "@langwatch\/workflow-contract";\n/,
    inline: [
      "// The two unions the mapping types read, widened for this copy: the CLI",
      "// has no workspace dependency on @langwatch/workflow-contract.",
      "type ComponentType = string;",
      "type Field = { type: string };",
      "",
    ],
  },
  {
    // Previous: the contract imported the two picker shapes from the component.
    what: 'the mapping picker type import ("~/components/variables/VariableMappingInput")',
    pattern:
      /import type \{\s*AvailableSource,\s*NestedField,\s*\} from "~\/components\/variables\/VariableMappingInput";\n/,
    inline: [
      "// The two mapping picker types the platform imports from its component,",
      "// declared inline so this copy needs no React tree.",
      "type NestedField = { name: string; label?: string; type: string; children?: NestedField[] };",
      "type AvailableSource = { id: string; name: string; type: string; fields: NestedField[] };",
      "",
    ],
  },
];

const src = fs.readFileSync(SOURCE, "utf8");
const matched = variants.find((variant) => variant.pattern.test(src));

if (!matched) {
  console.error(
    `evaluator-attachments.ts: no known non-relative type import was found.\n` +
      `Looked for:\n` +
      variants.map((variant) => `  - ${variant.what}`).join("\n") +
      `\n\nThe contract changed shape. Teach this script the new import and the\n` +
      `declarations that replace it, or the published SDK ships an import it\n` +
      `cannot resolve. See sdks/typescript/scripts/generate-evaluator-attachments.mjs.`,
  );
  process.exit(1);
}

fs.writeFileSync(OUTPUT, src.replace(matched.pattern, matched.inline.join("\n")));
console.log(`Wrote ${OUTPUT} (replaced ${matched.what})`);
