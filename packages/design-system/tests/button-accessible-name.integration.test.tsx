// @vitest-environment jsdom
// Spec: packages/design-system/specs/button-accessible-name.feature
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "../src/components/forms/button.tsx";
import { ActionRow } from "../src/components/overlays/action-row.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const plusIcon = <svg aria-hidden="true" data-testid="plus" />;

describe("Button", () => {
  /** @scenario A loading button is still named by its label */
  it.each([
    ["text", "Create"],
    ["icon and text", <span key="label">{plusIcon}Create</span>],
  ] as [string, ReactNode][])("keeps its name around loading with %s", (_kind, label) => {
    const view = renderWithDesignSystem(<Button>{label}</Button>);
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();

    view.rerender(<Button loading>{label}</Button>);
    const loading = screen.getByRole("button", { name: "Create" });
    expect(loading).toBeDisabled();
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("data-loading");
    expect(loading.textContent).toBe("Create");

    view.rerender(<Button>{label}</Button>);
    const after = screen.getByRole("button", { name: "Create" });
    expect(after).toBeEnabled();
    expect(after).not.toHaveAttribute("aria-busy");
  });

  /** @scenario An explicit name wins over the label while loading */
  it("lets aria-label and aria-labelledby name a loading button", () => {
    renderWithDesignSystem(
      <>
        <span id="outside">Save the view</span>
        <Button loading aria-label="Create dataset">
          Create
        </Button>
        <Button loading aria-labelledby="outside">
          Create
        </Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Create dataset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save the view" })).toBeInTheDocument();
  });

  /** @scenario Loading text and a custom spinner keep their meaning */
  it("names a loading button by its loading text, and a custom spinner never joins the name", () => {
    renderWithDesignSystem(
      <>
        <Button loading loadingText="Creating">
          Create
        </Button>
        <Button loading spinner={<img alt="working" />}>
          Add
        </Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Creating" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  /** @scenario A loading button cannot be activated again */
  it("ignores repeated clicks and key presses while loading, and submits its form once after", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const view = renderWithDesignSystem(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading onClick={onClick}>
          Create
        </Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Create" });

    await user.click(button);
    await user.dblClick(button);
    button.focus();
    await user.keyboard("{Enter} ");
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();

    view.rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit" onClick={onClick}>
          Create
        </Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /** @scenario A button still forwards its ref, submits its form and composes with asChild */
  it("hands its element to a ref and can render as another element", async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    renderWithDesignSystem(
      <>
        <Button ref={ref}>Plain</Button>
        <Button asChild loading onClick={onClick}>
          <a href="#next">Next</a>
        </Button>
      </>,
    );

    expect(ref.current).toBe(screen.getByRole("button", { name: "Plain" }));
    const link = screen.getByRole("link", { name: "Next" });
    expect(link.querySelectorAll("a")).toHaveLength(0);
    await user.click(link);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("a footer action that is saving", () => {
  /** @scenario A footer action that is saving keeps the action's label as its name */
  it("is named by the action's label and runs nothing on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithDesignSystem(
      <ActionRow primaryAction={{ label: "Create budget", loading: true, onClick }} />,
    );

    const button = screen.getByRole("button", { name: "Create budget" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
