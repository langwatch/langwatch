/**
 * @vitest-environment jsdom
 *
 * A provider row at ORGANIZATION scope, none at project scope (ADR-021): the picker must
 * still offer its models. @see specs/langy/langy-model-selection.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../../../behavior/langy-api.ts", () => ({
  api: {
    modelProvider: {
      listAllForProjectForFrontend: {
        useQuery: () => ({
          data: [
            {
              provider: "anthropic",
              enabled: true,
              customModels: null,
              customEmbeddingsModels: null,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
              scopeType: "ORGANIZATION",
              scopeId: "org-1",
            },
          ],
          isLoading: false,
        }),
      },
    },
  },
}));

import { LangyModelPill } from "../../elements/langy-model-pill.tsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

const OPTIONS = ["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5", "openai/gpt-5-mini"];

afterEach(() => cleanup());

function renderPill() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyModelPill
        model="anthropic/claude-sonnet-4-5"
        options={OPTIONS}
        onChange={() => undefined}
      />
    </DesignSystemProvider>,
  );
}

describe("given the project's only model provider is connected at the organization", () => {
  describe("when the composer's model picker opens", () => {
    /** @scenario "A provider configured on the organization enables its models in the picker" */
    it("offers that provider's models and none from an unconnected provider", async () => {
      const user = userEvent.setup();
      renderPill();

      await user.click(screen.getByTestId("langy-model-picker"));

      const offered = (await screen.findAllByRole("option")).map((option) =>
        option.textContent?.trim(),
      );
      expect(offered).toContain("claude-sonnet-4-5");
      expect(offered).toContain("claude-haiku-4-5");
      expect(offered.join(" ")).not.toContain("gpt-5-mini");
    });
  });
});

describe("given Langy rides beside a drawer", () => {
  describe("when the composer's model picker opens", () => {
    /** @scenario "The model list opens above the panel when Langy rides beside a drawer" */
    it("puts the model list on the overlay layer, above the panel", async () => {
      const user = userEvent.setup();
      renderPill();

      await user.click(screen.getByTestId("langy-model-picker"));

      const [option] = await screen.findAllByRole("option");
      const positioner = option?.closest<HTMLElement>('[data-part="positioner"]');
      // The panel sits at z 1600 beside a drawer and the drawer at 1500.
      expect(Number(positioner?.style.getPropertyValue("z-index"))).toBe(2010);
      expect(positioner?.style.getPropertyPriority("z-index")).toBe("important");
    });
  });
});

function renderLockedPill({ reason }: { reason?: "turn-active" }) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyModelPill
        model="anthropic/claude-sonnet-4-5"
        options={OPTIONS}
        onChange={() => undefined}
        disabled
        {...(reason ? { disabledReason: reason } : {})}
      />
    </DesignSystemProvider>,
  );
}

describe("given a turn is running and the model picker is locked", () => {
  describe("when the user hovers the model pill", () => {
    /** @scenario "The model in use stays visible while Langy is working" */
    it("names the provider and model, says the lock ends with the turn, and stays shut", async () => {
      const user = userEvent.setup();
      renderLockedPill({ reason: "turn-active" });

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.getAttribute("aria-disabled")).toBe("true");
      expect(picker.hasAttribute("disabled")).toBe(false);

      await user.hover(picker);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.textContent).toContain("Anthropic · claude-sonnet-4-5");
      expect(tooltip.textContent).toContain(
        "Langy is working. You can switch models when it stops.",
      );

      await user.click(picker);
      expect(picker.getAttribute("data-state")).toBe("closed");
    });
  });

  describe("when the picker is locked for another reason", () => {
    it("promises no switch, because no turn is about to stop", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderLockedPill({});

      const picker = screen.getByTestId("langy-model-picker");
      expect(picker.hasAttribute("disabled")).toBe(true);
      await user.hover(picker);

      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });
});
