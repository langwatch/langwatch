import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { plainConfirm } from "../transforms/plain-confirm.ts";

const file = "modules/example/browser/src/ui/blocks/example-confirm-dialog.tsx";
const IMPORTS = `import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text } from "@langwatch/design-system/primitives";
`;
const run = (source: string) => {
  const outcome = plainConfirm({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};
const compact = (value: string) => value.replace(/\s+/g, " ");
const confirm = ({ body = "<Text>Sure?</Text>", footer }: { body?: string; footer: string }) =>
  `${IMPORTS}export const A = () => (
    <Dialog.Root open={!!item} onOpenChange={({ open }) => { if (!open) onCancel(); }}>
      <Dialog.Content>
        <Dialog.Header><Dialog.Title>Delete this item?</Dialog.Title></Dialog.Header>
        <Dialog.Body>${body}</Dialog.Body>
        <Dialog.Footer>${footer}</Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );`;
const CANCEL = `<Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>`;

describe("hand-built yes/no Dialog to ConfirmDialog", () => {
  it("converts an exact match, adds the import and drops the unused ones", () => {
    const { output, skips } = run(
      confirm({
        body: "<Text>Deleting is permanent.</Text>",
        footer: `${CANCEL}<Button colorPalette="red" loading={busy} onClick={() => void go()}>Delete</Button>`,
      }),
    );
    expect(skips).toEqual([]);
    expect(output).toContain(
      `import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";`,
    );
    expect(output).not.toContain(`design-system/dialog"`);
    expect(output).not.toContain(`design-system/primitives"`);
    expect(compact(output)).toContain(
      `<ConfirmDialog open={!!item} onClose={onCancel} onConfirm={() => void go()} title="Delete this item?" description="Deleting is permanent." confirmLabel="Delete" loading={busy} />`,
    );
  });

  it("builds a template title from text around string expressions", () => {
    const { output, skips } = run(
      confirm({ footer: `${CANCEL}<Button loading={busy} onClick={go}>Delete</Button>` }).replace(
        "Delete this item?",
        'Delete item{named ? ` ${name}` : ""}?',
      ),
    );
    expect(skips).toEqual([]);
    expect(compact(output)).toContain('title={`Delete item${named ? ` ${name}` : ""}?`}');
  });

  it("keeps a non-destructive primary as tone default", () => {
    const { output } = run(
      confirm({
        footer: `${CANCEL}<Button colorPalette="blue" loading={busy} onClick={go}>Apply</Button>`,
      }),
    );
    expect(compact(output)).toContain(`confirmLabel="Apply" tone="default" loading={busy} />`);
  });

  it("leaves a Dialog that is more than a plain yes/no", () => {
    const cases: [Parameters<typeof confirm>[0], string][] = [
      [
        { footer: `${CANCEL}<Button onClick={go} disabled={!reason}>Delete</Button>` },
        "disabled is validation state",
      ],
      [
        { footer: `<Button onClick={keep}>Keep</Button><Button onClick={go}>Delete</Button>` },
        "is not one primary action and a Cancel",
      ],
      [
        {
          body: "<Text>a</Text><Input />",
          footer: `${CANCEL}<Button loading={busy} onClick={go}>Delete</Button>`,
        },
        "body is not one sentence",
      ],
      [
        { footer: `${CANCEL}<Button data-testid="ok" loading={busy} onClick={go}>Delete</Button>` },
        "confirm carries a test id",
      ],
      [
        { footer: `${CANCEL}<Button onClick={go} disabled>Delete</Button>` },
        "disabled is validation state",
      ],
    ];
    for (const [parts, reason] of cases) {
      const { edits, skips } = run(confirm(parts));
      expect(edits).toEqual([]);
      expect(skips.map((skip) => skip.reason)).toEqual([reason]);
    }
  });

  it("does not shadow another ConfirmDialog", () => {
    const { edits, skips } = run(`import { ConfirmDialog } from "./ops-confirm-dialog.tsx";
      ${confirm({ footer: `${CANCEL}<Button onClick={go}>Delete</Button>` })}
    `);
    expect(edits).toEqual([]);
    expect(skips.map((skip) => skip.reason)).toEqual(["`ConfirmDialog` is another component here"]);
  });
});
