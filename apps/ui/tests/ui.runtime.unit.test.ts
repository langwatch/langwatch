import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UiShellPort } from "../src/app/ui-runtime.port";
import { UiRuntime } from "../src/app/ui.runtime";

class TestUiShell extends UiShellPort {
  readonly prepare = vi.fn();
  readonly render = vi.fn<() => ReactNode>(() => createElement("main", null, "LangWatch"));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("UiRuntime", () => {
  it("prepares and mounts the browser shell once", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const shell = new TestUiShell();
    const runtime = UiRuntime.create({ document, shell });

    await act(() => {
      runtime.start();
      runtime.start();
    });

    expect(shell.prepare).toHaveBeenCalledOnce();
    expect(shell.render).toHaveBeenCalledOnce();
    expect(document.getElementById("root")?.textContent).toBe("LangWatch");

    await act(() => runtime.close());
  });

  it("keeps the existing missing-root failure after preparing the shell", () => {
    const shell = new TestUiShell();
    const runtime = UiRuntime.create({ document, shell });

    expect(() => runtime.start()).toThrow("Root element not found");
    expect(shell.prepare).toHaveBeenCalledOnce();
    expect(shell.render).not.toHaveBeenCalled();
  });

  it("cleans up a failed render so start can be retried", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const shell = new TestUiShell();
    shell.render.mockImplementationOnce(() => {
      throw new Error("Shell unavailable");
    });
    const runtime = UiRuntime.create({ document, shell });

    expect(() => runtime.start()).toThrow("Shell unavailable");

    await act(() => runtime.start());

    expect(shell.prepare).toHaveBeenCalledTimes(2);
    expect(shell.render).toHaveBeenCalledTimes(2);
    expect(document.getElementById("root")?.textContent).toBe("LangWatch");

    await act(() => runtime.close());
  });

  it("unmounts once and cannot restart after closing", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const runtime = UiRuntime.create({ document, shell: new TestUiShell() });

    await act(() => runtime.start());
    await act(() => {
      runtime.close();
      runtime.close();
    });

    expect(document.getElementById("root")?.innerHTML).toBe("");
    expect(() => runtime.start()).toThrow("UI runtime is closed.");
  });
});
