/**
 * @vitest-environment jsdom
 * The organization's Essential or Strict picker: the flag, picking, saving and the small print.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DataPrivacyScreen from "../data-privacy-screen.tsx";
import {
  api,
  confirmStrict,
  effectivePii,
  levelRadio,
  noPickerOrPrice,
  organizationRuleWith,
  pickedLevel,
  picker,
  renderScreen,
  snapshotWith,
} from "./data-privacy-screen.pii-level.fixture.tsx";

vi.mock("../../../behavior/data-privacy-api.ts", async () => {
  const { fakeDataPrivacyApi } = await import("./data-privacy-screen.pii-level.fixture.tsx");
  return { dataPrivacyApi: fakeDataPrivacyApi() };
});

const page = (options: Omit<Parameters<typeof renderScreen>[0], "screenElement">) =>
  renderScreen({ screenElement: <DataPrivacyScreen />, ...options });

describe("given the Data Privacy page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.snapshot = snapshotWith();
  });

  describe("when release_pii_redaction_model_enabled is off for the organization", () => {
    /** @scenario Without the flag the page offers no level picker and no price */
    it("shows no picker, no price, no model and the summary as before", () => {
      page({ flagOn: false });

      noPickerOrPrice();
      expect(effectivePii()).toBe("PII redactionEssential");
    });
  });

  describe("when the flag is on and the organization resolves to Essential", () => {
    /** @scenario With the flag the page offers Essential and Strict for the organization */
    it("shows Essential picked, included, and Strict as the model with its price", () => {
      page({ flagOn: true });

      expect(levelRadio("Essential")).toBeChecked();
      expect(levelRadio("Strict")).not.toBeChecked();
      const cards = within(picker());
      expect(cards.getByText("Included")).toBeInTheDocument();
      expect(cards.getByText("Standard detection")).toBeInTheDocument();
      expect(cards.getByText("LangWatch PII Redaction Model")).toBeInTheDocument();
      expect(screen.getByTestId("pii-redaction-model-price").textContent).toContain(
        "$0.50per 1M characters excl. VAT, pay as you go",
      );
    });

    /** @scenario The example follows the selected level */
    it("shows what Essential stores, with the name and the address as sent", () => {
      page({ flagOn: true });

      expect(screen.getByText("What Essential stores, on a synthetic span")).toBeInTheDocument();
      const stored = screen.getByTestId("pii-example-essential").textContent;
      expect(stored).toContain("Daniel Okafor");
      expect(stored).toContain("42 Larkspur Lane, Apt 7, Springfield");
      expect(stored).toContain("[EMAIL]");
      expect(screen.queryByTestId("pii-example-strict")).toBeNull();
    });
  });

  describe("when an admin picks Strict over an organization rule that drops input", () => {
    /** @scenario Picking Strict writes the organization rule and shows Strict's example */
    it("saves the organization rule at strict, keeps the drop and shows Strict's example", async () => {
      api.snapshot = snapshotWith({
        rules: [organizationRuleWith({ categories: { input: { disposition: "drop" } } })],
      });
      const { host } = page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));
      await confirmStrict();

      await waitFor(() => expect(api.setForScope).toHaveBeenCalledTimes(1));
      expect(api.setForScope).toHaveBeenCalledWith({
        projectId: "proj-1",
        scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } }, pii: { level: "strict" } },
      });
      expect(levelRadio("Strict")).toBeChecked();
      const stored = screen.getByTestId("pii-example-strict").textContent;
      expect(stored).toContain("[NAME]");
      expect(stored).toContain("[ADDRESS]");
      expect(stored).not.toContain("Daniel Okafor");
      await waitFor(() => expect(api.invalidate).toHaveBeenCalled());
      expect(host.successes.at(-1)?.title).toBe("Organization on Strict");
      expect(
        screen.getByText(
          "Strict is billed from the next trace. Projects or teams with their own Strict rule keep it when the organization moves to Essential.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when an admin picks Essential on a Strict organization", () => {
    /** @scenario Picking Essential on a Strict organization writes Essential back */
    it("saves the organization rule at essential", async () => {
      api.snapshot = snapshotWith({
        level: "strict",
        rules: [organizationRuleWith({ pii: { level: "strict" } })],
      });
      page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Essential"));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "essential" } } }),
        ),
      );
    });
  });

  describe("when saving the organization rule fails", () => {
    /** @scenario A failed save tells the admin and keeps the level that was stored */
    it("hands the raw error to the host and shows Essential again", async () => {
      const boom = new Error("nope");
      api.setForScope.mockRejectedValueOnce(boom);
      const { host } = page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));
      await confirmStrict();

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]).toEqual({
        error: boom,
        fallbackTitle: "Couldn't change the organization's PII level",
      });
      await waitFor(() => expect(pickedLevel()).toBe("Essential"));
    });
  });

  describe("when the caller cannot write a rule at the organization scope", () => {
    /** @scenario A member who cannot write the organization rule sees the picker read-only */
    it("disables both levels", () => {
      api.snapshot = snapshotWith({ canWriteOrganization: false });
      page({ flagOn: true });

      expect(levelRadio("Essential")).toBeDisabled();
      expect(levelRadio("Strict")).toBeDisabled();
    });
  });

  describe("when an admin opens the information beside Strict's price", () => {
    /** @scenario The billing and fallback small print sits behind the price */
    it("says what is billed and where a span goes when it falls back", async () => {
      page({ flagOn: true });

      await userEvent.setup().hover(screen.getByRole("button", { name: "How Strict is billed" }));

      expect(
        await screen.findByText(
          "Pay as you go, no quota or plan. Every span the model answers is billed by the characters sent, even when it finds nothing. Spans that fall back to the rule-based detector are free. Essential stays included.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "If the model is unavailable or a span's text is over 8,000 characters in total, that span is redacted by our rule-based detector (Presidio) instead. If that detector fails, the text can be sent to Google Cloud DLP.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when the flag is on and the organization resolves to Strict", () => {
    /** @scenario With the flag the effective summary names what runs the level */
    it("names the model in the effective summary", () => {
      api.snapshot = snapshotWith({ level: "strict" });
      page({ flagOn: true });

      expect(effectivePii()).toBe("PII redactionStrict · LangWatch PII Redaction Model");
    });
  });
});
