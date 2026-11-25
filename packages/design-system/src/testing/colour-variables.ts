import { system } from "../system/index.ts";

type TestColourMode = "light" | "dark";

export type TestColourVariables = {
  /** Switches the declarations first, then the html mode class the production hook observes. */
  setMode: (mode: TestColourMode) => void;
  /** Restores every custom property and mode class the helper touched. Safe to call twice. */
  dispose: () => void;
};

type Prior = { value: string; priority: string };
type Owned = Map<string, Prior>;

const MODE_CLASSES: readonly TestColourMode[] = ["light", "dark"];

function colourDeclarations({ mode }: { mode: TestColourMode }): Map<string, string> {
  const prefix = `--${system.tokens.prefix}-colors-`;
  const foundations = system.tokens.cssVarMap.get("base");
  const semantic = system.tokens.cssVarMap.get(`_${mode}`);
  if (!foundations?.size || !semantic?.size) {
    throw new Error(`The design system emits no ${mode} colour variables to install`);
  }
  const declarations = new Map<string, string>();
  for (const source of [foundations, semantic]) {
    for (const [name, value] of source) {
      if (name.startsWith(prefix)) {
        declarations.set(name, value);
      }
    }
  }
  return declarations;
}

function restoreProperty({ name, prior }: { name: string; prior: Prior }): void {
  if (prior.value) {
    document.body.style.setProperty(name, prior.value, prior.priority);
  } else {
    document.body.style.removeProperty(name);
  }
}

function applyDeclarations({
  owned,
  declarations,
}: {
  owned: Owned;
  declarations: Map<string, string>;
}): void {
  const style = document.body.style;
  for (const [name, prior] of owned) {
    if (!declarations.has(name)) {
      restoreProperty({ name, prior });
      owned.delete(name);
    }
  }
  for (const [name, value] of declarations) {
    if (!owned.has(name)) {
      owned.set(name, {
        value: style.getPropertyValue(name),
        priority: style.getPropertyPriority(name),
      });
    }
    style.setProperty(name, value);
  }
}

function applyModeClass({ mode }: { mode: TestColourMode }): void {
  for (const name of MODE_CLASSES) {
    document.documentElement.classList.toggle(name, name === mode);
  }
}

/**
 * jsdom ignores rules inside the `@layer tokens` block the provider emits, so a mounted
 * semantic colour never resolves. This writes the same variables, from the packaged system,
 * onto `<body>` where the production reader looks. Opt-in per test; never at import time.
 */
export function installTestColourVariables({
  mode = "light",
}: { mode?: TestColourMode } = {}): TestColourVariables {
  const owned: Owned = new Map();
  const priorClasses = MODE_CLASSES.filter((name) =>
    document.documentElement.classList.contains(name),
  );
  let disposed = false;

  const setMode = (next: TestColourMode): void => {
    if (disposed) {
      throw new Error("The test colour variables were disposed");
    }
    applyDeclarations({ owned, declarations: colourDeclarations({ mode: next }) });
    applyModeClass({ mode: next });
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    owned.forEach((prior, name) => restoreProperty({ name, prior }));
    owned.clear();
    MODE_CLASSES.forEach((name) =>
      document.documentElement.classList.toggle(name, priorClasses.includes(name)),
    );
  };

  setMode(mode);
  return { setMode, dispose };
}
