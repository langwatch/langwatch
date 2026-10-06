/**
 * @vitest-environment jsdom
 *
 * The provider grid Langy embeds: picking another provider starts its form from nothing.
 * @see specs/model-providers/onboarding-flow.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saves = vi.hoisted(() => [] as { provider: string; typed: string }[]);

vi.mock("../../../model/langy-host.ts", () => ({
  useLangyHost: () => ({
    project: () => ({ id: "proj-1" }),
    organization: () => ({ id: "org-1" }),
  }),
}));

// The form itself is the model-provider module's; what this surface owns is which provider it
// mounts and that a new pick mounts a new one.
vi.mock("../../../behavior/lent-edit-model-provider-form.tsx", () => ({
  LentEditModelProviderForm: ({
    providerKey,
    onSaved,
  }: {
    providerKey: string;
    onSaved: () => void;
  }) => (
    <form
      data-testid="provider-form"
      data-provider={providerKey}
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("field") as HTMLInputElement;
        saves.push({ provider: providerKey, typed: field.value });
        onSaved();
      }}
    >
      <input name="field" aria-label="Credential field" />
      <button type="submit">Save</button>
    </form>
  ),
}));

import { LangyModelProviderSetup } from "../model-provider-setup.tsx";

beforeEach(() => {
  // jsdom has no layout, and picking a provider scrolls its form into view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  saves.length = 0;
});

describe("given the provider grid in the Langy panel", () => {
  describe("when Custom, then Codex, then OpenAI are picked and only the OpenAI key is typed", () => {
    /** @scenario Switching providers before saving carries nothing over */
    it("saves once, for OpenAI, with nothing typed for another provider", async () => {
      const user = userEvent.setup();
      const onComplete = vi.fn();
      render(
        <DesignSystemProvider>
          <LangyModelProviderSetup onComplete={onComplete} />
        </DesignSystemProvider>,
      );
      const tile = (provider: string) =>
        screen
          .getAllByRole("button")
          .find((button) => button.getAttribute("aria-label")?.startsWith(provider))!;

      await user.click(tile("Custom"));
      expect(screen.getByTestId("provider-form").dataset.provider).toBe("custom");
      await user.type(screen.getByLabelText("Credential field"), "https://stale.acme.test/v1");

      await user.click(tile("Codex"));
      await user.click(screen.getByRole("button", { name: "OpenAI" }));
      expect(screen.getByTestId("provider-form").dataset.provider).toBe("openai");
      expect(screen.getByLabelText("Credential field")).toHaveValue("");

      await user.type(screen.getByLabelText("Credential field"), "sk-test-key");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(saves).toEqual([{ provider: "openai", typed: "sk-test-key" }]);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
