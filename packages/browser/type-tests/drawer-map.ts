import type { DrawersDifferingFromMap } from "@langwatch/browser-host/drawer";
import { expectTypeOf } from "vitest";

type EditorProps = { promptId?: string; onSave?: (prompt: { id: string }) => void };

type Map = { promptEditor: EditorProps };

type Matching = {
  promptEditor: { load: () => Promise<{ default: (props: EditorProps) => null }> };
  localOnly: { load: () => Promise<{ default: (props: { runId?: string }) => null }> };
};
expectTypeOf<DrawersDifferingFromMap<Matching, Map>>().toEqualTypeOf<never>();

type Drifted = {
  promptEditor: { load: () => Promise<{ default: (props: { promptId?: number }) => null }> };
};
expectTypeOf<DrawersDifferingFromMap<Drifted, Map>>().toEqualTypeOf<"promptEditor">();
