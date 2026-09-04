/**
 * @vitest-environment jsdom
 *
 * The parameter line field: what it offers while typed, and how the keyboard
 * drives the list.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeclaredParameter } from "~/components/suites/useRunSuite";
import { ParameterLineField } from "../run/ParameterLineField";
import { parameterPlaceholder } from "../run/parameter-suggestions";

const MODEL: DeclaredParameter = {
  name: "model",
  description: "The model the agent answers with",
  type: "string",
  options: ["gpt-5-mini", "gpt-5"],
  defaultValue: "gpt-5-mini",
  source: "agent",
  agentLabel: "support-agent · production",
};

const LOCALE: DeclaredParameter = {
  name: "locale",
  description: "The language of the conversation",
  defaultValue: "en",
  source: "scenario",
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** The field with its own state, the way a dialog holds it. */
function Field({
  initial = "",
  definitions = [LOCALE, MODEL],
  onCommit,
}: {
  initial?: string;
  definitions?: DeclaredParameter[];
  onCommit?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ParameterLineField
      ariaLabel="Parameters"
      testId="line"
      value={value}
      onChange={(next) => {
        setValue(next);
        onCommit?.(next);
      }}
      definitions={definitions}
      placeholder={parameterPlaceholder(definitions)}
    />
  );
}

describe("<ParameterLineField/>", () => {
  afterEach(cleanup);

  describe("when the empty line is focused", () => {
    /** @scenario "Key mode lists every declared parameter with its description, default and source" */
    it("lists every declared parameter with its description, default and source", async () => {
      const user = userEvent.setup();
      render(<Field />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("line"));

      const list = await screen.findByTestId("line-suggestions");
      const locale = within(list).getByTestId(
        "parameter-suggestion-key-locale",
      );
      expect(locale).toHaveTextContent("The language of the conversation");
      expect(locale).toHaveTextContent("default en");
      expect(locale).toHaveTextContent("scenario");
      const model = within(list).getByTestId("parameter-suggestion-key-model");
      expect(model).toHaveTextContent("default gpt-5-mini");
      expect(model).toHaveTextContent("support-agent · production");
    });

    /** @scenario "The placeholder reads the first declared parameter" */
    it("reads the first declared parameter as its placeholder", () => {
      render(<Field definitions={[MODEL, LOCALE]} />, { wrapper: Wrapper });

      expect(screen.getByTestId("line")).toHaveAttribute(
        "placeholder",
        "model=gpt-5-mini",
      );
    });
  });

  describe("when a name and its equals sign are typed", () => {
    /** @scenario "Value mode lists the options of a closed list" */
    it("lists the options, and a click writes the pair on the line", async () => {
      const user = userEvent.setup();
      render(<Field />, { wrapper: Wrapper });

      await user.type(screen.getByTestId("line"), "model=");

      const list = await screen.findByTestId("line-suggestions");
      expect(
        within(list)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["gpt-5-mini", "gpt-5"]);

      await user.click(
        within(list).getByTestId("parameter-suggestion-value-gpt-5"),
      );

      expect(screen.getByTestId("line")).toHaveValue("model=gpt-5");
      expect(screen.queryByTestId("line-suggestions")).not.toBeInTheDocument();
    });
  });

  describe("when the keyboard drives the list", () => {
    /** @scenario "The keyboard drives the list" */
    it("moves with the arrows, takes the entry on Enter, and closes on Escape", async () => {
      const user = userEvent.setup();
      render(<Field />, { wrapper: Wrapper });

      const line = screen.getByTestId("line");
      await user.click(line);
      const list = await screen.findByTestId("line-suggestions");
      expect(
        within(list).getByTestId("parameter-suggestion-key-locale"),
      ).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{ArrowDown}");
      expect(
        within(list).getByTestId("parameter-suggestion-key-model"),
      ).toHaveAttribute("aria-selected", "true");

      await user.keyboard("{Enter}");
      expect(line).toHaveValue("model=");
      // The key reopens the list on the values of that parameter.
      expect(
        within(await screen.findByTestId("line-suggestions")).getByTestId(
          "parameter-suggestion-value-gpt-5-mini",
        ),
      ).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByTestId("line-suggestions")).not.toBeInTheDocument();
      expect(line).toHaveValue("model=");

      await user.keyboard("{Tab}");
      expect(line).toHaveValue("model=");
    });

    it("takes the highlighted entry on Tab", async () => {
      const user = userEvent.setup();
      render(<Field />, { wrapper: Wrapper });

      const line = screen.getByTestId("line");
      await user.type(line, "model=gpt-5-m");
      await screen.findByTestId("line-suggestions");
      await user.keyboard("{Tab}");

      expect(line).toHaveValue("model=gpt-5-mini");
    });
  });

  describe("when text outside the options is typed", () => {
    /** @scenario "Free text always commits" */
    it("keeps the text and shows no list", async () => {
      const user = userEvent.setup();
      const onCommit = vi.fn();
      render(<Field onCommit={onCommit} />, { wrapper: Wrapper });

      const line = screen.getByTestId("line");
      await user.type(line, "model=claude");

      expect(line).toHaveValue("model=claude");
      expect(onCommit).toHaveBeenLastCalledWith("model=claude");
      expect(screen.queryByTestId("line-suggestions")).not.toBeInTheDocument();
      expect(line).not.toHaveAttribute("aria-invalid");
    });
  });

  describe("when a second pair is started after a comma", () => {
    it("offers the keys again for the new token", async () => {
      const user = userEvent.setup();
      render(<Field initial="model=gpt-5" />, { wrapper: Wrapper });

      const line = screen.getByTestId("line");
      await user.click(line);
      await user.type(line, ", lo");

      const list = await screen.findByTestId("line-suggestions");
      expect(
        within(list)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(expect.arrayContaining([expect.stringContaining("locale")]));
      await user.keyboard("{Enter}");
      expect(line).toHaveValue("model=gpt-5, locale=");
    });
  });

  describe("when the list is open", () => {
    it("points the input at the list of options and at the highlighted one", async () => {
      const user = userEvent.setup();
      render(<Field />, { wrapper: Wrapper });

      const line = screen.getByTestId("line");
      await user.click(line);

      const listbox = await screen.findByRole("listbox");
      expect(listbox.id).not.toBe("");
      expect(line).toHaveAttribute("aria-controls", listbox.id);

      const options = within(listbox).getAllByRole("option");
      expect(line).toHaveAttribute("aria-activedescendant", options[0]?.id);

      await user.keyboard("{ArrowDown}");
      expect(line).toHaveAttribute("aria-activedescendant", options[1]?.id);
    });
  });

  describe("when the server refused a value", () => {
    it("reads the refusal under the line", () => {
      render(
        <ParameterLineField
          ariaLabel="Parameters"
          testId="line"
          value="model=claude"
          onChange={() => undefined}
          definitions={[MODEL]}
          error="Choose one of gpt-5-mini, gpt-5."
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("line")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(
        screen.getByText("Choose one of gpt-5-mini, gpt-5."),
      ).toBeInTheDocument();
    });
  });
});
