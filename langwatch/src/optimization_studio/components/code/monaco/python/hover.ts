import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { PYTHON_BUILTIN_BY_NAME } from "../pythonStdlib";
import { ATTR_ACCESS, type ContractRef, scanImports } from "./shared";

export function registerHover(
  monaco: Monaco,
  contractRef: ContractRef,
): IDisposable {
  return monaco.languages.registerHoverProvider("python", {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      // Include the *full* hovered word — not just the prefix up to the cursor
      // — so `secrets.YEA_BOI` resolves correctly when the cursor is mid-word.
      // Naïvely concatenating `lineBefore + word.word` double-counted the
      // partial typed prefix and produced bogus attribute paths.
      const lineUpToWordEnd = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      });
      const attr = ATTR_ACCESS.exec(lineUpToWordEnd);
      if (attr) {
        const owner = attr[1];
        const name = attr[2];
        if (!owner || !name) return null;
        // `secrets.NAME` — show the secret name, its runtime type, and a
        // reminder of where it's managed.
        if (owner === "secrets") {
          const known = contractRef.current.secretNames.includes(name);
          return {
            contents: [
              { value: `**secrets.${name}**` },
              { value: "```python\n" + `secrets.${name}: str\n` + "```" },
              {
                value: known
                  ? "Project secret. Injected at runtime as a string — managed in Settings → Secrets."
                  : `⚠️ No secret named \`${name}\` is configured. Add it under Settings → Secrets, or fix the name.`,
              },
            ],
          };
        }
        const imports = scanImports(model.getValue());
        const mod = imports.get(owner);
        const member = mod?.members.find((m) => m.name === name);
        if (mod && member) {
          return {
            contents: [
              { value: `**${mod.name}.${member.name}**` },
              {
                value:
                  "```python\n" + (member.signature ?? member.name) + "\n```",
              },
              { value: member.doc ?? "" },
            ],
          };
        }
      }
      // Bare identifier — node input, output, or builtin (in that order).
      const input = contractRef.current.inputs.find(
        (f) => f.identifier === word.word,
      );
      if (input) {
        return {
          contents: [
            { value: `**${input.identifier}** *(node input)*` },
            { value: "```python\n" + `${input.identifier}: ${input.type}\n` + "```" },
            { value: "Wired in the Inputs section of the properties panel." },
          ],
        };
      }
      const output = contractRef.current.outputs.find(
        (f) => f.identifier === word.word,
      );
      if (output) {
        return {
          contents: [
            { value: `**${output.identifier}** *(node output)*` },
            {
              value:
                "```python\n" + `${output.identifier}: ${output.type}\n` + "```",
            },
            {
              value:
                "Declared in the Outputs section — return it as a key in the `__call__` dict.",
            },
          ],
        };
      }
      if (word.word === "secrets") {
        const count = contractRef.current.secretNames.length;
        return {
          contents: [
            { value: "**secrets** *(project secrets namespace)*" },
            { value: "```python\nsecrets: SimpleNamespace\n```" },
            {
              value: `Access with \`secrets.NAME\`. ${count} secret${count === 1 ? "" : "s"} available.`,
            },
          ],
        };
      }
      const builtin = PYTHON_BUILTIN_BY_NAME.get(word.word);
      if (builtin) {
        return {
          contents: [
            { value: `**${builtin.name}**` },
            {
              value:
                "```python\n" + (builtin.signature ?? builtin.name) + "\n```",
            },
            { value: builtin.doc ?? "" },
          ],
        };
      }
      return null;
    },
  });
}
