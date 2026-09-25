/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneNumberInput, type PhoneNumberInputProps } from "../phone-number-input.tsx";

type Change = Parameters<NonNullable<PhoneNumberInputProps["onChange"]>>;

function renderInput(props: Omit<PhoneNumberInputProps, "onChange"> = {}) {
  const changes: Change[] = [];
  render(
    <ChakraProvider value={defaultSystem}>
      <PhoneNumberInput {...props} onChange={(...change) => changes.push(change)} />
    </ChakraProvider>,
  );
  return {
    changes,
    select: screen.getByRole("combobox"),
    input: screen.getByRole("textbox"),
  };
}

afterEach(() => {
  document.head.querySelectorAll('meta[name="x-country"]').forEach((meta) => meta.remove());
  vi.restoreAllMocks();
});

describe("PhoneNumberInput", () => {
  describe("when given an E.164 value", () => {
    it("selects the value's country and shows it in national format", () => {
      const { select, input } = renderInput({ value: "+31612345678" });

      expect(select).toHaveValue("NL");
      expect(input).toHaveValue("06 12345678");
    });
  });

  describe("when the default country is not allowed", () => {
    it("selects the first allowed country", () => {
      const { select } = renderInput({ defaultCountry: "US", allowedCountries: ["NL", "DE"] });

      expect(select).toHaveValue("NL");
    });
  });

  describe("when the user types a number", () => {
    it("reports the E.164 number with its national form and validity", async () => {
      const { input, changes } = renderInput({ defaultCountry: "NL" });

      await userEvent.type(input, "0612345678");

      const [e164, meta] = changes.at(-1) ?? [];
      expect(e164).toBe("+31612345678");
      expect(meta).toEqual({
        country: "NL",
        national: "06 12345678",
        formatted: "06 12345678",
        isValid: true,
      });
    });
  });

  describe("when the user changes country", () => {
    it("reformats the digits for the new country and reports it", async () => {
      const { select, input, changes } = renderInput({ defaultCountry: "NL" });
      await userEvent.type(input, "0612345678");

      await userEvent.selectOptions(select, "DE");

      const [, meta] = changes.at(-1) ?? [];
      expect(meta?.country).toBe("DE");
      expect(meta?.formatted).toBe(input.getAttribute("value"));
    });
  });

  describe("when grouping frequently used countries", () => {
    it("renders a popular group and an all-countries group", () => {
      renderInput();

      expect(screen.getByRole("group", { name: "Popular" })).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "All countries" })).toBeInTheDocument();
    });

    it("renders a flat list when grouping is off", () => {
      renderInput({ groupFrequentlyUsedCountries: false, allowedCountries: ["NL", "DE"] });

      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });
  });

  describe("when auto-detecting the default country", () => {
    it("takes the country from the x-country meta tag", () => {
      const meta = document.createElement("meta");
      meta.name = "x-country";
      meta.content = "nl";
      document.head.append(meta);

      const { select } = renderInput({ autoDetectDefaultCountry: true });

      expect(select).toHaveValue("NL");
    });

    it("falls back to the browser locale's region", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);

      const { select } = renderInput({ autoDetectDefaultCountry: true });

      expect(select).toHaveValue("DE");
    });

    it("keeps the default when the meta country is not allowed, without trying the locale", () => {
      const meta = document.createElement("meta");
      meta.name = "x-country";
      meta.content = "FR";
      document.head.append(meta);
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);

      const { select } = renderInput({
        autoDetectDefaultCountry: true,
        allowedCountries: ["US", "DE"],
      });

      expect(select).toHaveValue("US");
    });

    it("respects an explicit default country", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"]);

      const { select } = renderInput({ autoDetectDefaultCountry: true, defaultCountry: "NL" });

      expect(select).toHaveValue("NL");
    });
  });
});
