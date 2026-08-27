import { createRoot, type Root } from "react-dom/client";
import type { UiShellPort } from "./ui-runtime.port";

export { UiShellPort } from "./ui-runtime.port";

export type UiRuntimeOptions = {
  document: Document;
  shell: UiShellPort;
  rootElementId?: string;
};

export class UiRuntime {
  static create(options: UiRuntimeOptions): UiRuntime {
    return new UiRuntime(options.document, options.shell, options.rootElementId ?? "root");
  }

  private root: Root | undefined;
  private closed = false;

  private constructor(
    private readonly document: Document,
    private readonly shell: UiShellPort,
    private readonly rootElementId: string,
  ) {}

  start(): void {
    if (this.closed) {
      throw new Error("UI runtime is closed.");
    }

    if (this.root) {
      return;
    }

    this.shell.prepare();

    const container = this.document.getElementById(this.rootElementId);
    if (!container) {
      throw new Error("Root element not found");
    }

    const root = createRoot(container);
    try {
      root.render(this.shell.render());
      this.root = root;
    } catch (error) {
      root.unmount();
      throw error;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.root?.unmount();
    this.root = void 0;
  }
}
