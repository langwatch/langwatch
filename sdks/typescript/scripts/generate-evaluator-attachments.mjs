// Copies evaluator-attachments.ts from the contract module, replacing its
// one non-relative type import with local declarations -- the published
// tarball has no workspace dependency on @langwatch/workflow-contract, so an
// unresolvable import here ships broken code. Two spellings are supported
// while the contract is mid-change; delete the stale branch once it settles.

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

// Independent of the variant above: the contract also reads the saved
// evaluator's field list from the evaluator contract. Same rule -- the
// published SDK has no workspace dependency on @langwatch/evaluator-contract,
// so the import has to be widened to a local declaration too.
const evaluatorFieldsImport = {
  what: 'the evaluator-contract type import ("@langwatch/evaluator-contract")',
  pattern: /import type \{\s*EvaluatorWithFields,?\s*\} from "@langwatch\/evaluator-contract";\n/,
  inline: [
    "// The evaluator field shape this file reads, widened for this copy: the",
    "// CLI has no workspace dependency on @langwatch/evaluator-contract.",
    "type EvaluatorField = { identifier: string; type: string; optional?: boolean };",
    "type EvaluatorWithFields = { fields: EvaluatorField[] };",
    "",
  ],
};

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

if (!evaluatorFieldsImport.pattern.test(src)) {
  console.error(
    `evaluator-attachments.ts: ${evaluatorFieldsImport.what} was not found.\n\n` +
      `The contract changed shape. Teach this script the new import and the\n` +
      `declarations that replace it, or the published SDK ships an import it\n` +
      `cannot resolve. See sdks/typescript/scripts/generate-evaluator-attachments.mjs.`,
  );
  process.exit(1);
}

const output = src
  .replace(matched.pattern, matched.inline.join("\n"))
  .replace(evaluatorFieldsImport.pattern, evaluatorFieldsImport.inline.join("\n"));

fs.writeFileSync(OUTPUT, output);
console.log(`Wrote ${OUTPUT} (replaced ${matched.what}; replaced ${evaluatorFieldsImport.what})`);
