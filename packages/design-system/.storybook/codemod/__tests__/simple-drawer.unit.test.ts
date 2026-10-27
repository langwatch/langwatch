import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { simpleDrawer } from "../transforms/simple-drawer.ts";

const file = "modules/example/browser/src/ui/sections/example-drawer.tsx";
const IMPORTS = `import { Drawer } from "@langwatch/design-system/drawer";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
`;
const run = (source: string) => {
  const outcome = simpleDrawer({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};
const compact = (value: string) => value.replace(/\s+/g, " ");

describe("part-built Drawer to the callable shape", () => {
  it("folds Root, Content, Header, Body and a footer; Cancel stays as footer.cancel", () => {
    const { output, skips } = run(`${IMPORTS}
      export const A = ({ open, onClose, save, saving }: P) => (
        <Drawer.Root
          open={open}
          placement="end"
          size="lg"
          onOpenChange={({ open: isOpen }) => {
            if (!isOpen) onClose();
          }}
        >
          <Drawer.Content bg="bg">
            <Drawer.Header>
              <Drawer.Title>Edit rule</Drawer.Title>
              <Drawer.Description>Changes apply at once.</Drawer.Description>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body padding={0}>
              <Text>Body</Text>
            </Drawer.Body>
            <Drawer.Footer>
              <HStack width="full" justify="end">
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button colorPalette="orange" loading={saving} onClick={save} data-testid="save">Save</Button>
              </HStack>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Root>
      );
    `);
    expect(skips).toEqual([]);
    const text = compact(output);
    expect(text).toContain(
      `<Drawer open={open} onClose={onClose} size="lg" title="Edit rule" subtitle="Changes apply at once." body="flush" busy={saving} footer={{ primaryAction: { label: "Save", onClick: save, loading: saving, "data-testid": "save" }, cancel: { onClick: onClose } }}> <Text>Body</Text> </Drawer>`,
    );
    expect(text).not.toContain("Drawer.");
    expect(output).toContain(`import { Text } from "@langwatch/design-system/primitives";`);
  });

  it("maps Drawer.Actions: start red is destructive, a secondary takes Cancel's place", () => {
    const { output, skips } = run(`${IMPORTS}
      export const A = () => (
        <Drawer.Root open onOpenChange={() => onClose()} size="2xl">
          <Drawer.Content>
            <Drawer.Header><Drawer.Title>Case</Drawer.Title></Drawer.Header>
            <Drawer.Body>x</Drawer.Body>
            <Drawer.Actions
              onCancel={onClose}
              start={<Button colorPalette="red" onClick={remove}>Delete</Button>}
              secondary={<Button onClick={dup}>Duplicate</Button>}
              primary={<Button colorPalette="red" onClick={go}>Go</Button>}
            />
          </Drawer.Content>
        </Drawer.Root>
      );
    `);
    expect(skips).toEqual([]);
    expect(compact(output)).toContain(
      `<Drawer onClose={onClose} size="lg" title="Case" footer={{ primaryAction: { label: "Go", onClick: go, danger: true }, secondaryAction: { label: "Duplicate", onClick: dup }, destructiveAction: { label: "Delete", onClick: remove } }}>x</Drawer>`,
    );
  });

  it("keeps a Cancel with its own handler, a Close label, an Actions onCancel and its label", () => {
    const wrap = (footer: string) => `${IMPORTS}
      export const A = () => (
        <Drawer.Root open onOpenChange={() => onClose()}>
          <Drawer.Content>
            <Drawer.Header><Drawer.Title>T</Drawer.Title></Drawer.Header>
            <Drawer.Body>x</Drawer.Body>
            ${footer}
          </Drawer.Content>
        </Drawer.Root>
      );
    `;
    const own = run(
      wrap(
        `<Drawer.Footer><Button onClick={() => discard()}>Cancel</Button><Button onClick={save}>Save</Button></Drawer.Footer>`,
      ),
    );
    expect(own.skips).toEqual([]);
    expect(compact(own.output)).toContain(
      `footer={{ primaryAction: { label: "Save", onClick: save }, cancel: { onClick: () => discard() } }}`,
    );
    const close = run(
      wrap(
        `<Drawer.Footer><Drawer.ActionTrigger asChild><Button>Close</Button></Drawer.ActionTrigger></Drawer.Footer>`,
      ),
    );
    expect(close.skips).toEqual([]);
    expect(compact(close.output)).toContain(
      `footer={{ cancel: { label: "Close", onClick: onClose } }}`,
    );
    const actions = run(
      wrap(
        `<Drawer.Actions onCancel={back} cancelLabel="Back" primary={<Button onClick={go}>Go</Button>} busy={busy} />`,
      ),
    );
    expect(actions.skips).toEqual([]);
    expect(compact(actions.output)).toContain(
      `busy={busy} footer={{ primaryAction: { label: "Go", onClick: go }, cancel: { label: "Back", onClick: back } }}`,
    );
    const bare = run(wrap(`<Drawer.Actions primary={<Button onClick={go}>Go</Button>} />`));
    expect(compact(bare.output)).toContain(`cancel: { onClick: onClose }`);
  });

  it("owns a form as=form and passes a child form's id to the submit action", () => {
    const { output, skips } = run(`${IMPORTS}
      export const A = () => (
        <>
          <Drawer.Root open onOpenChange={() => onClose()}>
            <Drawer.Content as="form" onSubmit={handleSubmit}>
              <Drawer.Header><Drawer.Title>One</Drawer.Title></Drawer.Header>
              <Drawer.Body>x</Drawer.Body>
              <Drawer.Footer><Button type="submit">Save</Button></Drawer.Footer>
            </Drawer.Content>
          </Drawer.Root>
          <Drawer.Root open onOpenChange={() => onClose()}>
            <Drawer.Content>
              <Drawer.Header><Drawer.Title>Two</Drawer.Title></Drawer.Header>
              <Drawer.Body><form id="f" onSubmit={go} /></Drawer.Body>
              <Drawer.Footer><Button type="submit" form="f" loading={busy}>Save</Button></Drawer.Footer>
            </Drawer.Content>
          </Drawer.Root>
        </>
      );
    `);
    expect(skips).toEqual([]);
    const text = compact(output);
    expect(text).toContain(
      `onSubmit={handleSubmit} footer={{ primaryAction: { label: "Save", type: "submit" } }}`,
    );
    expect(text).toContain(
      `footer={{ primaryAction: { label: "Save", type: "submit", form: "f", loading: busy } }}`,
    );
  });

  it("skips a trigger Cancel with its own handler, validation-disabled saves and extras", () => {
    const cases: [string, string][] = [
      [
        `<Drawer.Footer><Drawer.ActionTrigger asChild><Button onClick={discard}>Cancel</Button></Drawer.ActionTrigger><Button onClick={save}>Save</Button></Drawer.Footer>`,
        "Cancel has its own handler",
      ],
      [
        `<Drawer.Footer><Button onClick={save} disabled={!valid}>Save</Button></Drawer.Footer>`,
        "disabled is validation state",
      ],
      [`<Drawer.Footer><Text>note</Text></Drawer.Footer>`, "footer has other content"],
    ];
    for (const [footer, reason] of cases) {
      const { edits, skips } = run(`${IMPORTS}
        export const A = () => (
          <Drawer.Root open onOpenChange={() => onClose()}>
            <Drawer.Content>
              <Drawer.Header><Drawer.Title>T</Drawer.Title></Drawer.Header>
              <Drawer.Body>x</Drawer.Body>
              ${footer}
            </Drawer.Content>
          </Drawer.Root>
        );
      `);
      expect(edits).toEqual([]);
      expect(skips.map((skip) => skip.reason)).toEqual([reason]);
    }
  });

  it("skips Root props, a Trigger, a form library without a form, a title that is not a string", () => {
    const body = `<Drawer.Content><Drawer.Header><Drawer.Title>T</Drawer.Title></Drawer.Header><Drawer.Body>x</Drawer.Body></Drawer.Content>`;
    const cases: [string, string][] = [
      [
        `<Drawer.Root open modal={false} onOpenChange={() => onClose()}>${body}</Drawer.Root>`,
        "Drawer.Root prop `modal` is outside the mapping",
      ],
      [
        `<Drawer.Root onOpenChange={() => onClose()}>${body}</Drawer.Root>`,
        "no `open` prop (a Trigger opens it)",
      ],
      [
        `<Drawer.Root open onOpenChange={() => { save(); onClose(); }}>${body}</Drawer.Root>`,
        "close handler does more than one call",
      ],
      [
        `<Drawer.Root open onOpenChange={() => onClose()}><Drawer.Content><Drawer.Header><Drawer.Title>{name}</Drawer.Title></Drawer.Header><Drawer.Body>x</Drawer.Body></Drawer.Content></Drawer.Root>`,
        "title is not a plain string",
      ],
      [
        `<Drawer.Root open onOpenChange={() => onClose()}><Drawer.Content><Drawer.Header><Drawer.Title>T</Drawer.Title></Drawer.Header><Drawer.Body paddingBottom={8}>x</Drawer.Body></Drawer.Content></Drawer.Root>`,
        "Drawer.Body prop `paddingBottom` is outside the mapping",
      ],
    ];
    for (const [jsx, reason] of cases) {
      const { edits, skips } = run(`${IMPORTS}export const A = () => (${jsx});`);
      expect(edits).toEqual([]);
      expect(skips.map((skip) => skip.reason)).toEqual([reason]);
    }
    const form = run(`${IMPORTS}
      const form = useForm();
      export const A = () => (<Drawer.Root open onOpenChange={() => onClose()}>${body}</Drawer.Root>);
    `);
    expect(form.skips.map((skip) => skip.reason)).toEqual([
      "form library without a form submit action",
    ]);
  });

  it("never touches the hosts a person owns", () => {
    const source = `${IMPORTS}export const A = () => (<Drawer.Root open onOpenChange={() => onClose()}><Drawer.Content><Drawer.Header><Drawer.Title>T</Drawer.Title></Drawer.Header><Drawer.Body>x</Drawer.Body></Drawer.Content></Drawer.Root>);`;
    for (const owned of [
      "modules/trace/browser/src/ui/sections/explorer/trace-drawer/trace-drawer-shell.tsx",
      "modules/ops/browser/src/features/upgrades/ui/sections/upgrade-step-drawer.tsx",
      "modules/organization/browser/src/ui/sections/invite-member-drawer.tsx",
      "modules/scenario/browser/src/ui/sections/example-drawer.tsx",
      "modules/experiment/browser/src/ui/sections/example-drawer.tsx",
    ]) {
      const outcome = simpleDrawer({ file: owned, source });
      expect(outcome.edits).toEqual([]);
      expect(outcome.skips.map((skip) => skip.reason)).toEqual([
        "owned elsewhere or a special overlay host",
      ]);
    }
  });

  it("ignores a Drawer that is not the design-system one", () => {
    const { changes, skips } = run(`import { Drawer } from "./drawer.tsx";
      export const A = () => <Drawer.Root open />;
    `);
    expect(changes).toEqual([]);
    expect(skips).toEqual([]);
  });
});
