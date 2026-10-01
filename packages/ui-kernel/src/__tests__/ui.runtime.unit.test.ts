import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UiShell } from "../ui-shell";
import { UiRuntime } from "../ui.runtime";

class TestUiShell extends UiShell {
  readonly prepare = vi.fn();
  readonly render = vi.fn<() => ReactNode>(() => createElement("main", null, "LangWatch"));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("UiRuntime", () => {
  it("prepares and mounts the browser shell once", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const shell = new TestUiShell();
    const runtime = UiRuntime.create({ document, shell });

    act(() => {
      runtime.start();
      runtime.start();
    });

    expect(shell.prepare).toHaveBeenCalledOnce();
    expect(shell.render).toHaveBeenCalledOnce();
    expect(document.getElementById("root")?.textContent).toBe("LangWatch");

    act(() => runtime.close());
  });

  it("keeps the existing missing-root failure after preparing the shell", () => {
    const shell = new TestUiShell();
    const runtime = UiRuntime.create({ document, shell });

    expect(() => runtime.start()).toThrow("Root element not found");
    expect(shell.prepare).toHaveBeenCalledOnce();
    expect(shell.render).not.toHaveBeenCalled();
  });

  it("cleans up a failed render so start can be retried", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const shell = new TestUiShell();
    shell.render.mockImplementationOnce(() => {
      throw new Error("Shell unavailable");
    });
    const runtime = UiRuntime.create({ document, shell });

    expect(() => runtime.start()).toThrow("Shell unavailable");

    act(() => runtime.start());

    expect(shell.prepare).toHaveBeenCalledTimes(2);
    expect(shell.render).toHaveBeenCalledTimes(2);
    expect(document.getElementById("root")?.textContent).toBe("LangWatch");

    act(() => runtime.close());
  });

  it("unmounts once and cannot restart after closing", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const runtime = UiRuntime.create({ document, shell: new TestUiShell() });

    act(() => runtime.start());
    act(() => {
      runtime.close();
      runtime.close();
    });

    expect(document.getElementById("root")?.innerHTML).toBe("");
    expect(() => runtime.start()).toThrow("UI runtime is closed.");
  });
});
