/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AutomationTypePicker,
  type AutomationSource,
} from "../automation-type-picker";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function Harness({ sourceLocked = false }: { sourceLocked?: boolean }) {
  const [source, setSource] = useState<AutomationSource>("trace");
  return <AutomationTypePicker source={source} sourceLocked={sourceLocked} onChange={setSource} />;
}

describe("AutomationTypePicker", () => {
  afterEach(() => cleanup());

  it("shows Automation, Alert, and Schedule — never a Trace data card", () => {
    render(<Harness />, { wrapper: Wrapper });

    expect(screen.getByRole("button", { name: /Automation/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alert/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Schedule/i })).toBeInTheDocument();
    expect(screen.queryByText("Trace data")).not.toBeInTheDocument();
  });

  it("reports a Schedule selection through the controlled port", async () => {
    render(<Harness />, { wrapper: Wrapper });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Schedule/i }));

    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });

  it("marks the unpicked cards inert when the source is locked", () => {
    render(<Harness sourceLocked />, { wrapper: Wrapper });

    expect(screen.getByRole("button", { name: /Schedule/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
