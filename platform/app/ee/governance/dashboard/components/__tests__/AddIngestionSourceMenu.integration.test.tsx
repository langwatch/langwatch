// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Add source menu is the only way into the composer, so what it renders
 * IS the offer: every supported type with its vendor mark, grouped under the
 * two customer-facing headings, with plan-locked types visible but inert.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * Renders the real Chakra menu — mocking it would hide exactly the
 * open/disabled semantics these scenarios exist to pin.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddIngestionSourceMenu } from "../AddIngestionSourceMenu";

function renderMenu({
  isEnterprise,
  hint,
  disabledReason,
  onPick = vi.fn(),
}: {
  isEnterprise: boolean;
  hint?: string;
  disabledReason?: string;
  onPick?: (sourceType: string) => void;
}) {
  render(
    <ChakraProvider value={defaultSystem}>
      <AddIngestionSourceMenu
        isEnterprise={isEnterprise}
        hint={hint}
        disabledReason={disabledReason}
        onPick={onPick}
      >
        <button type="button">Add source</button>
      </AddIngestionSourceMenu>
    </ChakraProvider>,
  );
  return { onPick };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByText("Add source"));
  await waitFor(() => {
    expect(screen.getByText("Real-time streams")).toBeTruthy();
  });
  return user;
}

describe("given the Add source menu", () => {
  describe("when an enterprise admin opens it", () => {
    /** @scenario "Add source menu lists every type by vendor, grouped in plain language" */
    it("lists every source type under the two plain-language headings", async () => {
      renderMenu({ isEnterprise: true });
      await openMenu();

      expect(screen.getByText("Synced on a schedule")).toBeTruthy();
      for (const label of [
        "Generic OpenTelemetry",
        "Claude Code (Anthropic OAuth)",
        "Anthropic Claude (Cowork)",
        "Workato",
        "Microsoft Copilot Studio",
        "OpenAI Enterprise Compliance",
        "Anthropic Claude Enterprise Compliance",
        "Anthropic Admin API (usage & cost)",
        "Databricks AI/BI Genie",
        "Custom S3 audit log",
        "Custom HTTP audit-log API",
      ]) {
        expect(screen.getByText(label)).toBeTruthy();
      }

      // The retired directory-audit source is filtered out of the picker, so
      // the offer carries one Copilot entry, not two near-identical ones.
      expect(
        screen.queryByText("Microsoft Copilot Studio (Purview)"),
      ).toBeNull();
    });

    /** @scenario "Add source menu lists every type by vendor, grouped in plain language" */
    it("carries no technical mode suffix on any item", async () => {
      renderMenu({ isEnterprise: true });
      await openMenu();

      // An empty menu carries no suffix either, and the group headings that
      // openMenu waits on render with or without items under them. Prove the
      // items are there before reading anything into their absence.
      expect(screen.getAllByRole("menuitem").length).toBeGreaterThan(0);

      expect(screen.queryByText(/·\s*(push|pull|s3)/i)).toBeNull();
    });

    /** @scenario "Picking a type opens the composer committed to it" */
    it("hands the picked type to the caller", async () => {
      const { onPick } = renderMenu({ isEnterprise: true });
      const user = await openMenu();

      await user.click(screen.getByText("Databricks AI/BI Genie"));

      expect(onPick).toHaveBeenCalledWith("databricks_genie");
    });
  });

  describe("when a non-enterprise admin opens it", () => {
    /** @scenario "Non-enterprise plans see locked source types they cannot pick" */
    it("shows the gated types locked with the plan that unlocks them", async () => {
      renderMenu({ isEnterprise: false });
      await openMenu();

      const locked = screen.getByText("Databricks AI/BI Genie");
      expect(locked).toBeTruthy();
      const lockedItem = locked.closest("[role='menuitem']");
      expect(lockedItem?.getAttribute("aria-disabled")).toBe("true");
      expect(screen.getAllByText(/Enterprise/).length).toBeGreaterThan(0);
    });

    /** @scenario "Non-enterprise plans see locked source types they cannot pick" */
    it("never fires the pick for a locked type", async () => {
      const { onPick } = renderMenu({ isEnterprise: false });
      const user = await openMenu();

      await user.click(screen.getByText("Databricks AI/BI Genie"));

      expect(onPick).not.toHaveBeenCalled();
    });

    /** @scenario "Non-enterprise plans see locked source types they cannot pick" */
    it("still lets the one allowed type through", async () => {
      const { onPick } = renderMenu({ isEnterprise: false });
      const user = await openMenu();

      await user.click(screen.getByText("Generic OpenTelemetry"));

      expect(onPick).toHaveBeenCalledWith("otel_generic");
    });
  });

  describe("when the trigger carries a plan hint", () => {
    /**
     * Tooltip and Menu.Trigger are both asChild cloners; nested wrong they
     * clobber each other's DOM ids and the menu pins at the page origin
     * (see TriggerAnchor's docblock). This pins that the hint wrapper
     * leaves the menu working — the breakage is silent otherwise.
     */
    it("still opens the menu and hands over the pick", async () => {
      const { onPick } = renderMenu({
        isEnterprise: false,
        hint: "Your plan includes up to 3 sources.",
      });
      const user = await openMenu();

      await user.click(screen.getByText("Generic OpenTelemetry"));

      expect(onPick).toHaveBeenCalledWith("otel_generic");
    });

    it("shows the hint on hover", async () => {
      renderMenu({
        isEnterprise: false,
        hint: "Your plan includes up to 3 sources.",
      });
      const user = userEvent.setup();

      await user.hover(screen.getByText("Add source"));

      await waitFor(() => {
        expect(
          screen.getByText("Your plan includes up to 3 sources."),
        ).toBeTruthy();
      });
    });
  });

  describe("when the trigger is disabled with a reason", () => {
    /** @scenario "Non-enterprise plans see locked source types they cannot pick" */
    it("mounts no menu at all", async () => {
      const { onPick } = renderMenu({
        isEnterprise: false,
        disabledReason: "Source limit reached.",
      });
      const user = userEvent.setup();

      // The trigger is the caller's own button: it renders whether or not this
      // component does anything at all, so on its own it proves nothing and
      // the assertions below would report green off a broken render. The
      // reason on hover is the control, because only this component puts it
      // there — it goes quiet the moment the disabled path stops wiring up.
      await user.hover(screen.getByText("Add source"));
      await waitFor(() => {
        expect(screen.getByText("Source limit reached.")).toBeTruthy();
      });

      await user.click(screen.getByText("Add source"));

      expect(screen.queryByText("Real-time streams")).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
    });
  });
});
