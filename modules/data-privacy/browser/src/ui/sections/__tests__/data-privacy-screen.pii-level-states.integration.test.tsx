/**
 * @vitest-environment jsdom
 * The picker's other states: confirmations, free, Custom, Off, self-hosted and later changes.
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

describe("given the Data Privacy page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.snapshot = snapshotWith();
  });

  describe("when an admin picks Strict and then cancels", () => {
    /** @scenario Turning on Strict asks to confirm with the price */
    it("asks with the model and its price and saves nothing on cancel", async () => {
      page({ flagOn: true });
      const user = userEvent.setup();

      await user.click(levelRadio("Strict"));

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(dialog.textContent).toContain(
        "Strict uses the LangWatch PII Redaction Model at $0.50 per 1M characters excl. VAT, pay as you go. Turn it on?",
      );
      expect(api.setForScope).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(api.setForScope).not.toHaveBeenCalled();
      expect(pickedLevel()).toBe("Essential");
      // The native radios screen readers announce follow the shown level too.
      expect(levelRadio("Essential")).toBeChecked();
      expect(levelRadio("Strict")).not.toBeChecked();
    });
  });

  describe("when the organization is on the free list", () => {
    /** @scenario A free organization sees Strict as included and turns it on without a price */
    it("shows Strict as included and saves it without asking", async () => {
      page({ flagOn: true, free: true });

      expect(screen.getByTestId("pii-redaction-model-price").textContent).toBe(
        "Includedfor your organization",
      );
      expect(screen.queryByText(/\$0\.50/)).toBeNull();

      await userEvent.setup().click(levelRadio("Strict"));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "strict" } } }),
        ),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(/billed from the next trace/)).toBeNull();
    });
  });

  describe("when the organization is on Custom", () => {
    /** @scenario An organization on Custom sees its level and confirms replacing it */
    it("names Custom, picks neither level and asks before replacing it", async () => {
      api.snapshot = snapshotWith({
        level: "custom",
        entities: ["PERSON", "EMAIL_ADDRESS"],
        rules: [
          organizationRuleWith({ pii: { level: "custom", entities: ["EMAIL_ADDRESS", "PERSON"] } }),
        ],
      });
      page({ flagOn: true });
      const user = userEvent.setup();

      expect(screen.getByText("Organization on Custom (2 types)")).toBeInTheDocument();
      expect(pickedLevel()).toBeUndefined();

      await user.click(levelRadio("Essential"));
      const dialog = await screen.findByRole("dialog", { name: "Replace custom PII settings?" });
      expect(dialog.textContent).toContain(
        "This replaces your custom PII settings with Essential.",
      );
      expect(api.setForScope).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Replace" }));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "essential" } } }),
        ),
      );
    });
  });

  describe("when the organization has PII redaction off", () => {
    /** @scenario An organization with PII redaction off sees its level */
    it("names Off and picks neither level", () => {
      api.snapshot = snapshotWith({ level: "disabled" });
      page({ flagOn: true });

      expect(screen.getByText("Organization on Off")).toBeInTheDocument();
      expect(pickedLevel()).toBeUndefined();
    });
  });

  describe("when the deployment is self-hosted and the organization has no Enterprise licence", () => {
    /** @scenario A self-hosted deployment without an Enterprise license advertises the license */
    it("shows no picker or price, and the drawer advertises the licence", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "strict" } })] });
      page({
        flagOn: true,
        isSaaS: false,
        licence: "none",
        query: { rule: "PROJECT:proj-1:false" },
      });

      noPickerOrPrice();
      expect(effectivePii()).toBe("PII redactionEssential");
      const advert = await screen.findByTestId("pii-redaction-model-licence-advert");
      expect(advert.textContent).toContain("Strict here uses the rule-based detector.");
      expect(advert.textContent).toContain(
        "The LangWatch PII Redaction Model is part of LangWatch Enterprise.",
      );
      expect(within(advert).getByRole("link", { name: "Activate a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
      expect(document.body.textContent).not.toMatch(/LangWatch Cloud/);
    });

    it("tells a reader who cannot manage the licence to ask an admin, with no link", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "strict" } })] });
      page({
        flagOn: true,
        isSaaS: false,
        licence: "none",
        mayManageLicence: false,
        query: { rule: "PROJECT:proj-1:false" },
      });

      const advert = await screen.findByTestId("pii-redaction-model-licence-advert");
      expect(advert.textContent).toContain("Ask an organization admin to activate a license.");
      expect(within(advert).queryByRole("link")).toBeNull();
    });
  });

  describe("when the deployment is self-hosted, licensed, and runs the model", () => {
    /** @scenario A licensed self-hosted deployment that runs the model offers Strict on it, included */
    it("shows the picker with Strict included and no rule-based note", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "strict" } })] });
      page({
        flagOn: true,
        isSaaS: false,
        licence: "enterprise",
        query: { rule: "PROJECT:proj-1:false" },
      });

      expect(screen.getAllByTestId("pii-redaction-model-price")[0]?.textContent).toBe(
        "Includedwith your Enterprise license",
      );
      expect(screen.queryByText(/\$0\.50/)).toBeNull();
      // The drawer is open on the Strict rule, where a rule-based note would show.
      expect(await screen.findByTestId("pii-example-strict")).toBeInTheDocument();
      expect(screen.queryByText(/Strict here uses the rule-based detector/)).toBeNull();
    });
  });

  describe("when the deployment is self-hosted and licensed, without the model", () => {
    /** @scenario A licensed self-hosted deployment without the model says how to turn it on */
    it("shows no picker, and the drawer says how to turn the model on", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "strict" } })] });
      page({
        flagOn: false,
        isSaaS: false,
        licence: "enterprise",
        query: { rule: "PROJECT:proj-1:false" },
      });

      noPickerOrPrice();
      expect(
        await screen.findByText(
          "Strict here uses the rule-based detector. Your Enterprise license includes the LangWatch PII Redaction Model: ask whoever runs your deployment to turn it on.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("pii-redaction-model-licence-advert")).toBeNull();
    });
  });

  describe("when the level changes elsewhere after a successful pick", () => {
    /** @scenario A level changed elsewhere after a pick shows the stored level */
    it("shows the stored level, not the old pick", async () => {
      const { rerender } = page({ flagOn: true });

      await userEvent.setup().click(levelRadio("Strict"));
      await confirmStrict();
      await waitFor(() => expect(api.setForScope).toHaveBeenCalledTimes(1));

      api.snapshot = snapshotWith({ level: "strict" });
      rerender();
      expect(pickedLevel()).toBe("Strict");

      api.snapshot = snapshotWith({ level: "essential" });
      rerender();
      expect(pickedLevel()).toBe("Essential");
    });
  });

  describe("when a rule is saved at Strict from the drawer", () => {
    /** @scenario Saving a rule at Strict asks to confirm with the price */
    it("asks with the price and saves only once confirmed", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "essential" } })] });
      page({ flagOn: true, query: { rule: "PROJECT:proj-1:false" } });
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText("PII redaction"));
      await user.click(await screen.findByRole("option", { name: /^Strict/ }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(dialog.textContent).toContain("LangWatch PII Redaction Model at $0.50");
      expect(api.setForScope).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole("button", { name: "Turn on Strict" }));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({
            scope: { scopeType: "PROJECT", scopeId: "proj-1" },
            config: { pii: { level: "strict" } },
          }),
        ),
      );
    });
  });

  describe("when a rule is saved at Strict before the subscription's currency is read", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("saves nothing and quotes no price, reads the plan again, then asks at the euro price", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "essential" } })] });
      const { answerPlan, mounted } = page({
        flagOn: true,
        billingCurrency: "unknown",
        query: { rule: "PROJECT:proj-1:false" },
      });
      const user = userEvent.setup();

      await saveRuleAtStrict(user);

      const waiting = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(waiting.textContent).toContain("hasn't loaded yet");
      expect(waiting.textContent).not.toMatch(/[$€]/);
      expect(mounted().refreshes).toBe(1);
      await user.click(within(waiting).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(mounted().refreshes).toBe(2));
      expect(api.setForScope).not.toHaveBeenCalled();

      answerPlan("EUR");

      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      await waitFor(() => expect(dialog.textContent).toContain("€0.425 per 1M characters"));
      expect(api.setForScope).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "Turn on Strict" }));

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "strict" } } }),
        ),
      );
    });
  });

  describe("when the page opens before the subscription's currency is read", () => {
    /** @scenario "Before the price is read the page still offers the level picker, quoting no price" */
    it("offers the picker with no price, reads the plan on Try again, and asks once it answers", async () => {
      const { answerPlan, mounted } = page({ flagOn: true, billingCurrency: "unknown" });
      const user = userEvent.setup();

      const price = screen.getByTestId("pii-redaction-model-price");
      expect(price.textContent).toContain("Price not loaded");
      expect(price.textContent).not.toMatch(/[$€]/);
      await user.click(within(price).getByRole("button", { name: "Try again" }));
      expect(mounted().refreshes).toBe(1);

      await user.click(levelRadio("Strict"));
      const waiting = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(waiting.textContent).toContain("hasn't loaded yet");
      expect(mounted().refreshes).toBe(2);
      expect(api.setForScope).not.toHaveBeenCalled();

      answerPlan("EUR");
      const dialog = await screen.findByRole("dialog", { name: "Turn on Strict?" });
      await waitFor(() => expect(dialog.textContent).toContain("€0.425 per 1M characters"));
      await user.click(within(dialog).getByRole("button", { name: "Turn on Strict" }));

      await waitFor(() => expect(api.setForScope).toHaveBeenCalledTimes(1));
    });

    /** @scenario "Before the price is read the page still offers the level picker, quoting no price" */
    it("shows the model in the drawer at Strict with no price", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "strict" } })] });
      page({ flagOn: true, billingCurrency: "unknown", query: { rule: "PROJECT:proj-1:false" } });

      const drawer = await screen.findByRole("dialog");
      expect(within(drawer).getByText("LangWatch PII Redaction Model")).toBeInTheDocument();
      const price = within(drawer).getByTestId("pii-redaction-model-price");
      expect(price.textContent).toContain("Price not loaded");
      expect(price.textContent).not.toMatch(/[$€]/);
    });
  });

  describe("when the model flag turns off while a Strict save waits for the price", () => {
    /** @scenario "A Strict rule save waits for the subscription's currency" */
    it("saves the rule without asking, as a save with the flag off does", async () => {
      api.snapshot = snapshotWith({ rules: [projectRuleWith({ pii: { level: "essential" } })] });
      const { setFlag } = page({
        flagOn: true,
        billingCurrency: "unknown",
        query: { rule: "PROJECT:proj-1:false" },
      });
      const user = userEvent.setup();

      await saveRuleAtStrict(user);
      await screen.findByRole("dialog", { name: "Turn on Strict?" });
      expect(api.setForScope).not.toHaveBeenCalled();

      setFlag({ name: "release_pii_redaction_model_enabled", on: false });

      await waitFor(() =>
        expect(api.setForScope).toHaveBeenCalledWith(
          expect.objectContaining({ config: { pii: { level: "strict" } } }),
        ),
      );
      expect(api.setForScope).toHaveBeenCalledTimes(1);
    });
  });
});

async function saveRuleAtStrict(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText("PII redaction"));
  await user.click(await screen.findByRole("option", { name: /^Strict/ }));
  await user.click(screen.getByRole("button", { name: "Save" }));
}
