/**
 * @vitest-environment jsdom
 * Accepting the PII Redaction Model's price from the picker or a Strict rule; a member who cannot
 * accept it is never asked. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
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
  organizationRuleWith,
  pickedLevel,
  picker,
  projectRuleWith,
  renderScreen,
  snapshotWith,
} from "./data-privacy-screen.pii-level.fixture.tsx";

vi.mock("../../../behavior/data-privacy-api.ts", async () => {
  const { fakeDataPrivacyApi } = await import("./data-privacy-screen.pii-level.fixture.tsx");
  return { dataPrivacyApi: fakeDataPrivacyApi() };
});

const page = (options: Omit<Parameters<typeof renderScreen>[0], "screenElement">) =>
  renderScreen({ screenElement: <DataPrivacyScreen />, ...options });

const BILLED =
  "Strict is billed from the next trace. Projects or teams with their own Strict rule keep it when the organization moves to Essential.";
const ASKS_FIRST = "Switching to the model asks an organization admin to accept its price first.";
const STAYS_RULE_BASED =
  "Strict stays rule-based (Presidio), at no charge, until an organization admin accepts the model's price.";

/** The organization on Strict from before the model, its price never accepted. */
const legacyStrict = (options: { canWriteOrganization?: boolean } = {}) =>
  snapshotWith({
    level: "strict",
    rules: [organizationRuleWith({ pii: { level: "strict" } })],
    accepted: false,
    ...options,
  });

const switchButton = () =>
  screen.getByRole("button", { name: "Switch to the PII Redaction Model" });

describe("given a Cloud organization on the model flag whose price no admin accepted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.snapshot = snapshotWith({ accepted: false });
  });

  describe("when the organization is already on Strict", () => {
    /** @scenario An organization on Strict that never accepted the price sees it is rule-based, at no charge */
    it("says Strict is rule-based at no charge, offers the switch and names no bill", () => {
      api.snapshot = legacyStrict();
      page({ flagOn: true });

      expect(screen.getByText("Organization on Strict (rule-based)")).toBeInTheDocument();
      expect(
        within(picker()).getByText("Currently on rule-based (Presidio), no charge"),
      ).toBeInTheDocument();
      expect(within(picker()).getByTestId("pii-redaction-model-price")).toBeInTheDocument();
      expect(switchButton()).toBeInTheDocument();
      expect(screen.getByText(ASKS_FIRST)).toBeInTheDocument();
      expect(screen.queryByText(BILLED)).toBeNull();
      expect(effectivePii()).not.toContain("LangWatch PII Redaction Model");
    });

    /** @scenario Accepting the price from the picker switches the organization to the model */
    it("asks with the price, accepts only once confirmed and then says Strict is billed", async () => {
      api.snapshot = legacyStrict();
      page({ flagOn: true });
      const user = userEvent.setup();

      await user.click(switchButton());

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(dialog.textContent).toContain(
        "Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. This covers every Strict rule in your organization: each one moves to the model and is billed. Turn it on?",
      );
      expect(api.acceptPiiRedactionModel).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Turn on Strict" }));

      await waitFor(() =>
        expect(api.acceptPiiRedactionModel).toHaveBeenCalledWith({ organizationId: "org-1" }),
      );
      expect(api.setForScope).not.toHaveBeenCalled();
      expect(await screen.findByText(BILLED)).toBeInTheDocument();
      expect(screen.queryByText("Organization on Strict (rule-based)")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Switch to the PII Redaction Model" }),
      ).toBeNull();
    });

    it("gives a member who cannot accept no switch, and still says it is rule-based", () => {
      api.snapshot = legacyStrict({ canWriteOrganization: false });
      page({ flagOn: true });

      expect(screen.getByText("Organization on Strict (rule-based)")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch to the PII Redaction Model" }),
      ).toBeNull();
      expect(screen.getByText(ASKS_FIRST)).toBeInTheDocument();
    });
  });

  describe("when an admin picks Strict over Essential and confirms the price", () => {
    /** @scenario Picking Strict through the price prompt records the acceptance first */
    it("records the acceptance, then saves the organization rule at strict", async () => {
      page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));
      await confirmStrict();

      await waitFor(() => expect(api.setForScope).toHaveBeenCalledTimes(1));
      expect(api.acceptPiiRedactionModel).toHaveBeenCalledWith({ organizationId: "org-1" });
      expect(api.acceptPiiRedactionModel.mock.invocationCallOrder[0]).toBeLessThan(
        api.setForScope.mock.invocationCallOrder[0] ?? 0,
      );
      expect(api.setForScope).toHaveBeenCalledWith(
        expect.objectContaining({ config: { pii: { level: "strict" } } }),
      );
    });

    /** @scenario Picking Strict through the price prompt records the acceptance first */
    it("saves nothing and tells the admin when the acceptance fails", async () => {
      const boom = new Error("nope");
      api.acceptPiiRedactionModel.mockRejectedValueOnce(boom);
      const { host } = page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));
      await confirmStrict();

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]?.error).toBe(boom);
      expect(api.setForScope).not.toHaveBeenCalled();
      expect(pickedLevel()).toBe("Essential");
    });
  });

  describe("when the organization is on the free list", () => {
    it("needs no acceptance: no rule-based badge, no switch, Strict saved without asking", async () => {
      api.snapshot = snapshotWith({ level: "strict", accepted: false });
      page({ flagOn: true, free: true });

      expect(screen.queryByText("Currently on rule-based (Presidio), no charge")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Switch to the PII Redaction Model" }),
      ).toBeNull();
      expect(screen.getByText("Organization on Strict")).toBeInTheDocument();
      expect(screen.queryByText(ASKS_FIRST)).toBeNull();
    });
  });

  describe("when a member who cannot accept sets a project rule to Strict in the drawer", () => {
    /** @scenario A member who cannot accept the price is not asked it in the rule drawer */
    it("says Strict stays rule-based until an admin accepts, and saves without asking", async () => {
      api.snapshot = snapshotWith({
        rules: [projectRuleWith({ pii: { level: "essential" } })],
        canWriteOrganization: false,
        accepted: false,
      });
      page({ flagOn: true, query: { rule: "PROJECT:proj-1:false" } });
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText("PII redaction"));
      await user.click(await screen.findByRole("option", { name: /^Strict/ }));

      expect(await screen.findByText(STAYS_RULE_BASED)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({
            scope: { scopeType: "PROJECT", scopeId: "proj-1" },
            config: { pii: { level: "strict" } },
          }),
        ),
      );
      expect(screen.queryByRole("dialog", { name: "Turn on Strict?" })).toBeNull();
      expect(api.acceptPiiRedactionModel).not.toHaveBeenCalled();
    });
  });

  describe("when an admin saves a project rule at Strict and confirms the price", () => {
    /** @scenario An admin saving a rule at Strict accepts the price with the confirmation */
    it("records the acceptance and saves the rule", async () => {
      api.snapshot = snapshotWith({
        rules: [projectRuleWith({ pii: { level: "essential" } })],
        accepted: false,
      });
      page({ flagOn: true, query: { rule: "PROJECT:proj-1:false" } });
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText("PII redaction"));
      await user.click(await screen.findByRole("option", { name: /^Strict/ }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(api.acceptPiiRedactionModel).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "Turn on Strict" }));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "strict" } } }),
        ),
      );
      expect(api.acceptPiiRedactionModel).toHaveBeenCalledWith({ organizationId: "org-1" });
    });
  });
});
