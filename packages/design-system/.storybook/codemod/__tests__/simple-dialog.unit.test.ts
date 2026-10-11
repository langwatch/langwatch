import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { simpleDialog } from "../transforms/simple-dialog.ts";

const file = "modules/example/browser/src/ui/blocks/example-dialog.tsx";
const IMPORTS = `import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text } from "@langwatch/design-system/primitives";
`;
const run = (source: string) => {
  const outcome = simpleDialog({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};
const compact = (value: string) => value.replace(/\s+/g, " ");
const dialog = ({
  root = "",
  content = "",
  footer,
}: {
  root?: string;
  content?: string;
  footer: string;
}) =>
  `${IMPORTS}export const A = () => (
    <Dialog.Root open={open} onOpenChange={({ open: o }) => { if (!o) onClose(); }} ${root}>
      <Dialog.Content ${content}>
        <Dialog.Header><Dialog.Title>Title</Dialog.Title></Dialog.Header>
        <Dialog.Body>x</Dialog.Body>
        ${footer}
      </Dialog.Content>
    </Dialog.Root>
  );`;

describe("part-built Dialog to the callable shape", () => {
  it("keeps the default Cancel, maps the primary and a description", () => {
    const { output, skips } = run(`${IMPORTS}
      export const A = () => (
        <Dialog.Root open={open} size="lg" onOpenChange={({ open: o }) => { if (!o) onClose(); }}>
          <Dialog.Content data-testid="d">
            <Dialog.Header>
              <Dialog.Title>Revoke key?</Dialog.Title>
              <Dialog.Description>It stops working.</Dialog.Description>
            </Dialog.Header>
            <Dialog.Body paddingBottom={6}>x</Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild><Button variant="outline" disabled={busy}>Cancel</Button></Dialog.ActionTrigger>
              <Button colorPalette="red" loading={busy} onClick={go}>Revoke</Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>
      );
    `);
    expect(skips).toEqual([]);
    expect(compact(output)).toContain(
      `<Dialog open={open} onClose={onClose} size="lg" title="Revoke key?" description="It stops working." primaryAction={{ label: "Revoke", onClick: go, loading: busy, danger: true }} busy={busy} data-testid="d">x</Dialog>`,
    );
    expect(output).toContain(`import { Text } from "@langwatch/design-system/primitives";`);
  });

  it("reads a differently labelled close as cancelLabel and a lone alternative as secondaryAction", () => {
    const close = run(
      dialog({
        footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Close</Button></Dialog.ActionTrigger></Dialog.Footer>`,
      }),
    );
    expect(compact(close.output)).toContain(`cancelLabel="Close"`);
    const two = run(
      dialog({
        footer: `<Dialog.Footer><Button onClick={later}>Later</Button><Button onClick={go}>Set up</Button></Dialog.Footer>`,
      }),
    );
    expect(compact(two.output)).toContain(
      `primaryAction={{ label: "Set up", onClick: go }} secondaryAction={{ label: "Later", onClick: later }}`,
    );
  });

  it("keeps a centred dialog centred and gives a Root with no size the shape's md", () => {
    const footer = `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger><Button onClick={go}>OK</Button></Dialog.Footer>`;
    const centred = run(dialog({ root: `placement="center"`, footer }));
    expect(centred.skips).toEqual([]);
    expect(compact(centred.output)).toContain(
      `<Dialog open={open} onClose={onClose} size="md" placement="center" title="Title"`,
    );
    const top = run(dialog({ root: `placement="top" size="sm"`, footer }));
    expect(compact(top.output)).toContain(`<Dialog open={open} onClose={onClose} title="Title"`);
    expect(compact(top.output)).not.toContain("placement");
  });

  it("maps a literal maxWidth to a size and passes the setter's flag as a close", () => {
    const { output, skips } = run(`${IMPORTS}
      export const A = () => (
        <Dialog.Root open={isOpen} onOpenChange={({ open }) => setOpen(open)}>
          <Dialog.Content maxWidth="640px">
            <Dialog.Header><Dialog.Title>T</Dialog.Title></Dialog.Header>
            <Dialog.Body>x</Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger>
              <Button onClick={go}>OK</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Root>
      );
    `);
    expect(skips).toEqual([]);
    expect(compact(output)).toContain(
      `<Dialog open={isOpen} onClose={() => setOpen(false)} size="lg" title="T"`,
    );
  });

  it("skips a Cancel with its own handler, no Cancel, a Trigger, a dynamic colour and widths with no size", () => {
    const cases: [Parameters<typeof dialog>[0], string][] = [
      [
        {
          footer: `<Dialog.Footer><Button onClick={discard}>Cancel</Button><Button onClick={go}>OK</Button></Dialog.Footer>`,
        },
        "Cancel has its own handler",
      ],
      [
        { footer: `<Dialog.Footer><Button onClick={go}>OK</Button></Dialog.Footer>` },
        "no Cancel: the shape draws one",
      ],
      [
        {
          footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger><Button colorPalette={x ? "red" : "blue"} onClick={go}>OK</Button></Dialog.Footer>`,
        },
        "Button `colorPalette` is dynamic",
      ],
      [
        {
          content: `maxWidth="1200px"`,
          footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger></Dialog.Footer>`,
        },
        "maxWidth fits no size",
      ],
      [
        {
          content: `onClick={(e) => e.stopPropagation()}`,
          footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger></Dialog.Footer>`,
        },
        "Dialog.Content prop `onClick` is outside the mapping",
      ],
      [
        {
          root: `placement="bottom"`,
          footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger></Dialog.Footer>`,
        },
        "placement is not top or center",
      ],
      [
        {
          root: `size="xs"`,
          footer: `<Dialog.Footer><Dialog.ActionTrigger asChild><Button>Cancel</Button></Dialog.ActionTrigger></Dialog.Footer>`,
        },
        "dialog size `xs` has no slot",
      ],
    ];
    for (const [parts, reason] of cases) {
      const { edits, skips } = run(dialog(parts));
      expect(edits).toEqual([]);
      expect(skips.map((skip) => skip.reason)).toEqual([reason]);
    }
  });
});
