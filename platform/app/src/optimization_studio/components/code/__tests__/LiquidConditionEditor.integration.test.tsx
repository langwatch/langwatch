/**
 * @vitest-environment jsdom
 *
 * The Liquid condition input must make mistakes visible: a malformed
 * expression shows an error and a reference to an input that does not exist
 * shows a warning, instead of failing silently. Monaco is stubbed out (it
 * cannot mount in jsdom); the inline message and the {% %} affordance are
 * the surface under test.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/color-mode", () => ({
  useColorMode: () => ({ colorMode: "light" }),
}));
vi.mock("@monaco-editor/react", () => ({ default: () => null }));
vi.mock("../CodeEditorModal", () => ({ vscodeThemeName: () => "vs" }));

import { LiquidConditionEditor } from "../LiquidConditionEditor";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);
const noop = () => {};

const renderEditor = (value: string, availableVariables: string[]) =>
  render(
    <LiquidConditionEditor
      value={value}
      onChange={noop}
      availableVariables={availableVariables}
    />,
    { wrapper: Wrapper },
  );

describe("LiquidConditionEditor", () => {
  afterEach(() => cleanup());

  describe("given a valid condition over a known input", () => {
    it("shows neither an error nor a warning", () => {
      renderEditor("amount < 5", ["amount"]);
      expect(
        screen.queryByTestId("if-else-condition-error"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("if-else-condition-warning"),
      ).not.toBeInTheDocument();
    });

    it("frames the field with the liquid tag adornments", () => {
      renderEditor("amount < 5", ["amount"]);
      expect(screen.getByText("{%")).toBeInTheDocument();
      expect(screen.getByText("%}")).toBeInTheDocument();
    });
  });

  describe("given malformed syntax", () => {
    /** @scenario The condition flags invalid Liquid syntax */
    it("shows an error message", () => {
      renderEditor("foobar < 5 asdjoiasjdioa 123 %^!", ["amount"]);
      expect(screen.getByTestId("if-else-condition-error")).toBeInTheDocument();
    });
  });

  describe("given a reference to an input that does not exist", () => {
    /** @scenario The condition warns when it references an unknown input */
    it("warns and names the unknown input", () => {
      renderEditor("foobar < 5", ["amount"]);
      const warning = screen.getByTestId("if-else-condition-warning");
      expect(warning).toHaveTextContent("foobar");
    });
  });
});
