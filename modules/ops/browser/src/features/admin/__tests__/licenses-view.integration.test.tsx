/** @vitest-environment jsdom */
/**
 * The licenses page's filters: each choice says how many licenses it lists,
 * and an empty list says whether the filters or the search emptied it.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import type { LicenseCounts } from "../model/license-terms.ts";
import LicensesView from "../ui/sections/licenses-view.tsx";

const { asked, answer } = vi.hoisted(() => ({
  asked: [] as Record<string, unknown>[],
  answer: { counts: {} as LicenseCounts, isPlaceholderData: false },
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    licenseRegistry: {
      getAll: {
        useQuery: (input: Record<string, unknown>) => {
          asked.push(input);
          return {
            data: { licenses: [], total: 0, counts: answer.counts },
            isLoading: false,
            isFetching: false,
            isPlaceholderData: answer.isPlaceholderData,
            error: null,
          };
        },
      },
    },
  },
}));
vi.mock("../behavior/use-license-commands.ts", () => ({
  useLicenseCommands: () => ({ resetInstanceBinding: { mutate: vi.fn() } }),
}));
vi.mock("../ui/sections/activation-codes-section.tsx", () => ({
  ActivationCodesSection: () => null,
}));
vi.mock("../ui/sections/license-detail-drawer.tsx", () => ({ LicenseDetailDrawer: () => null }));
vi.mock("../ui/sections/license-issue-drawer.tsx", () => ({ LicenseIssueDrawer: () => null }));
vi.mock("../ui/sections/license-revoke-dialog.tsx", () => ({ LicenseRevokeDialog: () => null }));

const lastAsked = () => asked.at(-1);

describe("LicensesView", () => {
  beforeEach(() => {
    asked.length = 0;
    answer.isPlaceholderData = false;
  });

  describe("given internal licenses that are all revoked or expired", () => {
    beforeEach(() => {
      // What the service answers on the default choices: each count keeps the other filter.
      answer.counts = { active: 0, inactive: 0, customer: 0, internal: 0, all: 2 };
    });

    /** @scenario The console's license filters say what they hide */
    it("opens on active customer licenses and shows how many each choice lists", () => {
      renderWithOpsHost(<LicensesView />);

      expect(lastAsked()).toMatchObject({ status: "active", audience: "customer" });
      expect(screen.getByRole("radio", { name: /Active\s*0/ })).toBeTruthy();
      expect(screen.getByRole("radio", { name: /Internal tests\s*0/ })).toBeTruthy();
    });

    /** @scenario The console's license filters say what they hide */
    it("says the filters emptied the list, and shows every license when asked", () => {
      renderWithOpsHost(<LicensesView />);

      expect(screen.getByText(/No licenses match these filters/)).toBeTruthy();
      expect(screen.getByText(/2 licenses match other choices/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

      expect(lastAsked()).toMatchObject({ status: undefined, audience: undefined });
    });
  });

  describe("given a search that matches no license at all", () => {
    beforeEach(() => {
      answer.counts = { active: 0, inactive: 0, customer: 0, internal: 0, all: 0 };
    });

    /** @scenario The console's license filters say what they hide */
    it("blames the search, not the filters, and clearing it empties the search", async () => {
      renderWithOpsHost(<LicensesView />);
      fireEvent.change(screen.getByPlaceholderText(/Search by customer/), {
        target: { value: "nobody" },
      });

      expect(await screen.findByText(/No licenses match the search/)).toBeTruthy();
      expect(screen.queryByText(/No licenses match these filters/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

      expect(screen.getByPlaceholderText<HTMLInputElement>(/Search by customer/).value).toBe("");
      expect(lastAsked()).toMatchObject({ status: undefined, audience: undefined });
    });
  });

  describe("given an empty registry and no search", () => {
    beforeEach(() => {
      answer.counts = { active: 0, inactive: 0, customer: 0, internal: 0, all: 0 };
    });

    it("says the registry is empty", () => {
      renderWithOpsHost(<LicensesView />);

      expect(screen.getByText(/No licenses in the registry yet/)).toBeTruthy();
    });
  });

  describe("given an empty list kept on screen while the next query loads", () => {
    /** @scenario The console's license filters say what they hide */
    it("says nothing about the list until the answer arrives", () => {
      answer.counts = { active: 0, inactive: 0, customer: 0, internal: 0, all: 0 };
      answer.isPlaceholderData = true;
      renderWithOpsHost(<LicensesView />);

      expect(screen.queryByText(/No licenses in the registry yet/)).toBeNull();
      expect(screen.queryByText(/No licenses match/)).toBeNull();
    });
  });
});
