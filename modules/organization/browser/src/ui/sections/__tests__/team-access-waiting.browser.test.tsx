import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { renderWithOrganizationHost } from "../../../testing.tsx";
import { TeamAccessWaiting } from "../team-access-waiting.tsx";

const screenshots = "../../../../../../../.claude/tmp/astra-identity";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("light", "dark");
});

describe("given a member waiting for team access", () => {
  for (const mode of ["light", "dark"]) {
    describe(`when viewed in ${mode} mode`, () => {
      /** @scenario "The team access dialog fits its content on desktop and mobile" */
      it("centres a content-sized dialog and keeps its actions inside a narrow viewport", async () => {
        await page.viewport(1280, 800);
        document.documentElement.classList.add(mode);
        renderWithOrganizationHost(
          <TeamAccessWaiting organizationName="Local Dev Organization" onCheckAccess={vi.fn()} />,
        );
        const dialog = screen.getByRole("dialog", { name: "Waiting for team access" });
        await waitFor(() => {
          const bounds = dialog.getBoundingClientRect();
          expect(bounds.width).toBeLessThan(600);
          expect(bounds.height).toBeLessThan(450);
          expect(Math.abs(bounds.top + bounds.height / 2 - 400)).toBeLessThan(10);
        });
        await page.screenshot({ path: `${screenshots}/dialog-after-${mode}.png` });
        await page.viewport(390, 844);
        await waitFor(() => {
          expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(390);
          expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
          expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        });
        await page.screenshot({ path: `${screenshots}/dialog-after-mobile-${mode}.png` });
      });
    });
  }
});
