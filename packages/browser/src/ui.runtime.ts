import { createRoot, type Root } from "react-dom/client";

import type { UiShell } from "./ui-shell.ts";

export type UiRuntimeOptions = {
  document: Document;
  shell: UiShell;
  rootElementId?: string;
};

/** One root per container, so a hot reload that re-runs the entry re-renders into it. */
const mountedRoots = new WeakMap<Element, Root>();

export class UiRuntime {
  static create(options: UiRuntimeOptions): UiRuntime {
    return new UiRuntime(options.document, options.shell, options.rootElementId ?? "root");
  }

  private container: Element | undefined;
  private closed = false;

  private constructor(
    private readonly document: Document,
    private readonly shell: UiShell,
    private readonly rootElementId: string,
  ) {}

  start(): void {
    if (this.closed) {
      throw new Error("UI runtime is closed.");
    }

    if (this.container) {
      return;
    }

    this.shell.prepare();

    const container = this.document.getElementById(this.rootElementId);
    if (!container) {
      throw new Error("Root element not found");
    }

    const root = mountedRoots.get(container) ?? createRoot(container);
    try {
      root.render(this.shell.render());
      mountedRoots.set(container, root);
      this.container = container;
    } catch (error) {
      mountedRoots.delete(container);
      root.unmount();
      throw error;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    if (this.container) {
      mountedRoots.get(this.container)?.unmount();
      mountedRoots.delete(this.container);
    }
    this.container = void 0;
  }
}
