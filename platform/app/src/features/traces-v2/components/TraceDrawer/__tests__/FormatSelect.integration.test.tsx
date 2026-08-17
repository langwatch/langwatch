/**
 * @vitest-environment jsdom
 *
 * The compact format selector: active format in the pill with a caret, the
 * alternatives in the menu it opens. See specs/traces-v2/io-toolbar.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LuCode, LuEye } from "react-icons/lu";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FormatSelect } from "../FormatSelect";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

describe("FormatSelect", () => {
  describe("when rendered with string options", () => {
    it("shows the active option in the trigger and the rest in the menu", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <FormatSelect
          value="flat"
          onChange={onChange}
          options={["flat", "json"]}
          ariaLabel="Attributes view format"
        />,
        { wrapper },
      );

      const trigger = screen.getByRole("button", {
        name: "Attributes view format",
      });
      expect(trigger).toHaveTextContent("Flat");

      await user.click(trigger);
      // Initialisms keep their casing; plain values read as words.
      await user.click(await screen.findByRole("menuitem", { name: "JSON" }));

      expect(onChange).toHaveBeenCalledWith("json");
    });

    /**
     * Keyboard selection has to reach the same handler as a pointer. zag
     * activates the highlighted item by dispatching a real click on it, which
     * is what lets one `onClick` serve both.
     *
     * The active option is JSON and the keyboard picks the first one, so the
     * reported value cannot be the one that was already active. Each press is
     * awaited: the highlight moves through machine state, and an Enter sent
     * before it commits activates whatever was highlighted before.
     */
    it("picks an option from the keyboard", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <FormatSelect
          value="json"
          onChange={onChange}
          options={["flat", "json"]}
          ariaLabel="Attributes view format"
        />,
        { wrapper },
      );

      screen.getByRole("button", { name: "Attributes view format" }).focus();
      await user.keyboard("{Enter}");
      await screen.findByRole("menuitem", { name: "Flat" });

      await user.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(screen.getByRole("menuitem", { name: "Flat" })).toHaveAttribute(
          "data-highlighted",
        ),
      );
      await user.keyboard("{Enter}");

      await waitFor(() => expect(onChange).toHaveBeenCalledWith("flat"));
    });
  });

  describe("when the active option carries submodes", () => {
    it("renders their icon toggles inside the pill", async () => {
      const user = userEvent.setup();
      const onSubmodeChange = vi.fn();
      render(
        <FormatSelect
          value="markdown"
          onChange={vi.fn()}
          options={[
            "text",
            {
              value: "markdown",
              submodes: {
                value: "rendered",
                onChange: onSubmodeChange,
                options: [
                  { value: "rendered", label: "Rendered", icon: LuEye },
                  { value: "source", label: "Source", icon: LuCode },
                ],
              },
            },
          ]}
        />,
        { wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Source view" }));
      expect(onSubmodeChange).toHaveBeenCalledWith("source");
    });
  });
});
