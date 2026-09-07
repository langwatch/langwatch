/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryFilterInput } from "../QueryFilterInput";

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ChakraProvider value={defaultSystem}>
      <QueryFilterInput value={value} onChange={setValue} placeholder="query" />
    </ChakraProvider>
  );
}

const textbox = () => screen.getByRole("textbox") as HTMLTextAreaElement;

afterEach(cleanup);

describe("QueryFilterInput", () => {
  describe("when typing a partial field name", () => {
    it("suggests the matching field and appends a colon on accept", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(textbox());
      await user.type(textbox(), "stat");

      // The `status` field's label surfaces (distinct from "Scenario status").
      const option = await screen.findByText("Status");
      await user.click(option);

      expect(textbox().value).toBe("status:");
    });
  });

  describe("when a field is already typed", () => {
    it("suggests that field's values and appends a space on accept", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(textbox());
      await user.type(textbox(), "status:o");

      const option = await screen.findByText("ok");
      await user.click(option);

      expect(textbox().value).toBe("status:ok ");
    });
  });

  describe("when the dropdown is open", () => {
    it("closes on Escape without changing the query", async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(textbox());
      await user.type(textbox(), "stat");
      expect(await screen.findByText("Status")).toBeTruthy();

      await user.keyboard("{Escape}");

      expect(screen.queryByText("Status")).toBeNull();
      expect(textbox().value).toBe("stat");
    });
  });
});
