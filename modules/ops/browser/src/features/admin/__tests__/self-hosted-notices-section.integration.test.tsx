/** @vitest-environment jsdom */
/**
 * Cloud admin's notices to self-hosted installs: listed, written, published and withdrawn.
 * Spec: enterprise/modules/licensing/specs/self-hosted-notices.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { SelfHostedNoticesSection } from "../ui/sections/self-hosted-notices-section.tsx";

const draft = {
  id: "shnotice_draft",
  severity: "security",
  title: "Upgrade to 3.4.2",
  body: "A vulnerability is fixed in 3.4.2.",
  url: "https://langwatch.ai/security",
  fixedIn: "3.4.2",
  status: "draft",
  expiresAt: null,
  publishedAt: null,
  publishedBy: null,
  createdAt: "2026-10-21T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
};

const published = {
  ...draft,
  id: "shnotice_live",
  severity: "info",
  title: "LangWatch 3.5.0 is out",
  fixedIn: null,
  status: "published",
  publishedAt: "2026-10-21T11:00:00.000Z",
  publishedBy: "olive@langwatch.ai",
};

const listResult: { data?: unknown[]; error: unknown; isLoading: boolean } = {
  data: [],
  error: null,
  isLoading: false,
};

const calls: { procedure: string; input: unknown }[] = [];

function mutation(procedure: string) {
  return {
    useMutation: () => ({
      mutate: (input: unknown) => calls.push({ procedure, input }),
      isPending: false,
    }),
  };
}

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ selfHostedNotices: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    selfHostedNotices: {
      getAll: { useQuery: () => ({ ...listResult, refetch: vi.fn() }) },
      create: mutation("create"),
      update: mutation("update"),
      publish: mutation("publish"),
      withdraw: mutation("withdraw"),
    },
  },
}));

function renderSection() {
  return renderWithOpsHost(<SelfHostedNoticesSection />, { host: fakeOpsHost() });
}

describe("SelfHostedNoticesSection", () => {
  beforeEach(() => {
    listResult.data = [];
    listResult.error = null;
    listResult.isLoading = false;
    calls.length = 0;
  });

  describe("given a LangWatch Cloud admin on Ops, Self-hosted notices", () => {
    it("lists each notice with its severity, status, and who published it", () => {
      listResult.data = [draft, published];

      renderSection();

      expect(screen.getByText("Upgrade to 3.4.2")).toBeTruthy();
      expect(screen.getByText("LangWatch 3.5.0 is out")).toBeTruthy();
      expect(screen.getByText("Draft")).toBeTruthy();
      // The column header and the published notice's badge.
      expect(screen.getAllByText("Published")).toHaveLength(2);
      expect(screen.getByText("by olive@langwatch.ai")).toBeTruthy();
    });

    it("says there are none rather than showing an empty table", () => {
      renderSection();

      expect(screen.getByText("No notices yet")).toBeTruthy();
    });

    it("names a list that cannot be read instead of reading as empty", () => {
      listResult.data = undefined;
      listResult.error = new Error("boom");

      renderSection();

      expect(screen.getByText("Couldn't load notices")).toBeTruthy();
      expect(screen.queryByText("No notices yet")).toBeNull();
    });

    describe("when they write a security notice with a link and fixed in 3.4.2", () => {
      /** @scenario "Cloud admin staff publish a notice from Ops" */
      it("saves it as a draft with every field, then publishes it from the list", async () => {
        renderSection();

        fireEvent.click(screen.getByRole("button", { name: "New notice" }));
        fireEvent.change(await screen.findByLabelText("Severity"), {
          target: { value: "security" },
        });
        fireEvent.change(screen.getByPlaceholderText("Upgrade to 3.4.2"), {
          target: { value: "  Upgrade to 3.4.2  " },
        });
        fireEvent.change(
          screen.getByPlaceholderText("What changed, and what the operator should do about it"),
          { target: { value: "A vulnerability is fixed in 3.4.2." } },
        );
        fireEvent.change(screen.getByPlaceholderText("https://"), {
          target: { value: "https://langwatch.ai/security" },
        });
        fireEvent.change(screen.getByPlaceholderText("3.4.2"), { target: { value: "3.4.2" } });
        fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

        await waitFor(() =>
          expect(calls).toEqual([
            {
              procedure: "create",
              input: {
                severity: "security",
                title: "Upgrade to 3.4.2",
                body: "A vulnerability is fixed in 3.4.2.",
                url: "https://langwatch.ai/security",
                fixedIn: "3.4.2",
                expiresAt: null,
              },
            },
          ]),
        );

        listResult.data = [draft];
        calls.length = 0;
        renderSection();
        fireEvent.click(screen.getAllByRole("button", { name: "Publish" })[0]!);

        expect(calls).toEqual([{ procedure: "publish", input: { id: "shnotice_draft" } }]);
      });
    });

    describe("when they write a notice whose link is not https", () => {
      it("says so on the field and sends nothing", async () => {
        renderSection();

        fireEvent.click(screen.getByRole("button", { name: "New notice" }));
        fireEvent.change(await screen.findByPlaceholderText("Upgrade to 3.4.2"), {
          target: { value: "A title" },
        });
        fireEvent.change(screen.getByPlaceholderText("https://"), {
          target: { value: "http://langwatch.ai" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));

        expect(await screen.findByText("Link to an https:// address.")).toBeTruthy();
        expect(calls).toEqual([]);
      });
    });

    describe("when they withdraw a published notice", () => {
      it("withdraws that notice", () => {
        listResult.data = [published];

        renderSection();
        fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

        expect(calls).toEqual([{ procedure: "withdraw", input: { id: "shnotice_live" } }]);
      });
    });
  });
});
