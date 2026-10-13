import { describe, expect, it } from "vitest";

import { applyEdits } from "../ast.ts";
import { opsConfirmDialog } from "../transforms/ops-confirm-dialog.ts";

const file = "modules/ops/browser/src/features/example/ui/sections/example.tsx";
const IMPORT = `import { ConfirmDialog } from "../../../../ui/elements/ops-confirm-dialog.tsx";`;
const run = (source: string) => {
  const outcome = opsConfirmDialog({ file, source });
  return { ...outcome, output: applyEdits({ source, edits: outcome.edits }) };
};

describe("ops ConfirmDialog to the design-system ConfirmDialog", () => {
  it("renames isLoading, keeps children and points the import at the design system", () => {
    const { output, skips } = run(`${IMPORT}
      export const A = ({ close }: { close: () => void }) => (
        <>
          <ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" isLoading={false} />
          <ConfirmDialog key="b" open onClose={() => setOpen(false)} onConfirm={go} title="T" description={d} isLoading={busy}>
            <Input />
          </ConfirmDialog>
        </>
      );
    `);
    expect(skips).toEqual([]);
    expect(output).toContain(
      `import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";`,
    );
    expect(output).toContain(
      `<ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" loading={false} />`,
    );
    expect(output).toContain(
      `<ConfirmDialog key="b" open onClose={() => setOpen(false)} onConfirm={go} title="T" description={d} loading={busy}>`,
    );
  });

  it("keeps the other names of a shared import", () => {
    const { output } = run(`import { ConfirmDialog, other } from "./ops-confirm-dialog.tsx";
      export const A = () => <ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" isLoading />;
    `);
    expect(output).toContain(
      `import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";`,
    );
    expect(output).toContain(`import { other } from "./ops-confirm-dialog.tsx";`);
  });

  it("leaves a whole file alone when one site has no DS equivalent", () => {
    const { edits, skips } = run(`${IMPORT}
      export const A = () => (
        <>
          <ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" isLoading />
          <ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" isLoading confirmDisabled />
          <ConfirmDialog {...props} />
          <ConfirmDialog open onClose={close} onConfirm={go} title="T" description="D" isLoading tone="warning" />
        </>
      );
    `);
    expect(edits).toEqual([]);
    expect(skips.map((skip) => skip.reason)).toEqual([
      "maps, but another site in the file does not",
      "`confirmDisabled` has no DS equivalent",
      "spreads props",
      "`tone` has no DS equivalent",
    ]);
  });

  it("ignores another module's own ConfirmDialog", () => {
    const { changes, skips } = run(`import { ConfirmDialog } from "./confirm-dialog.tsx";
      export const A = () => <ConfirmDialog open onClose={close} />;
    `);
    expect(changes).toEqual([]);
    expect(skips).toEqual([]);
  });
});
