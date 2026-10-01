/**
 * @vitest-environment jsdom
 *
 * The Liquid condition input makes mistakes visible with errors and warnings.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/design-system/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));
vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("@langwatch/workflow-browser-kit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  vscodeThemeName: () => "vs",
}));

import { LiquidConditionEditor } from "../liquid-condition-editor.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);
const noop = () => {};

const renderEditor = (value: string, availableVariables: string[]) =>
  render(
    <LiquidConditionEditor value={value} onChange={noop} availableVariables={availableVariables} />,
    { wrapper: Wrapper },
  );

describe("LiquidConditionEditor", () => {
  afterEach(() => cleanup());

  describe("given a valid condition over a known input", () => {
    it("shows neither an error nor a warning", () => {
      renderEditor("amount < 5", ["amount"]);
      expect(screen.queryByTestId("if-else-condition-error")).toBeNull();
      expect(screen.queryByTestId("if-else-condition-warning")).toBeNull();
    });

    it("frames the field with the liquid tag adornments", () => {
      renderEditor("amount < 5", ["amount"]);
      expect(screen.getByText("{%")).toBeTruthy();
      expect(screen.getByText("%}")).toBeTruthy();
    });
  });

  describe("given malformed syntax", () => {
    /** @scenario The condition flags invalid Liquid syntax */
    it("shows an error message", () => {
      renderEditor("foobar < 5 asdjoiasjdioa 123 %^!", ["amount"]);
      expect(screen.getByTestId("if-else-condition-error")).toBeTruthy();
    });
  });

  describe("given a reference to an input that does not exist", () => {
    /** @scenario The condition warns when it references an unknown input */
    it("warns and names the unknown input", () => {
      renderEditor("foobar < 5", ["amount"]);
      const warning = screen.getByTestId("if-else-condition-warning");
      expect(warning.textContent).toContain("foobar");
    });
  });
});
