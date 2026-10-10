/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost, type FakeOpsHost } from "../../../testing.tsx";
import { OrganizationEditDrawer } from "../ui/sections/organizations-view.tsx";

type UpdateCallbacks = { onSuccess: () => void; onError: (error: unknown) => void };

const mutate =
  vi.fn<
    (input: { id: string; data: Record<string, unknown> }, callbacks: UpdateCallbacks) => void
  >();

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminUpdate: () => ({ mutate, isPending: false }),
}));

const organization = {
  id: "org-acme",
  name: "Acme",
  slug: "acme",
  phoneNumber: null,
  ssoDomain: null,
  ssoProvider: null,
  usageSpendingMaxLimit: null,
  datasetAttachmentMaxMb: null,
  signedDPA: false,
  promoCode: null,
  stripeCustomerId: null,
  currency: "USD" as const,
  pricingModel: "SEAT_EVENT" as const,
  useCustomS3: false,
  createdAt: "2026-04-01T10:00:00.000Z",
};

const FIELD = "Max dataset file size (MB)";
const RANGE = /whole number of megabytes from 20 to 1024/i;

let host: FakeOpsHost;

function openDrawer(stored: number | null = null) {
  const onClose = vi.fn();
  renderWithOpsHost(
    <OrganizationEditDrawer
      organization={{ ...organization, datasetAttachmentMaxMb: stored }}
      onClose={onClose}
    />,
    { host },
  );
  return { onClose };
}

function enterAndSave(value: string) {
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("Feature: Back office organization max dataset file size", () => {
  beforeEach(() => {
    mutate.mockReset();
    host = fakeOpsHost({ isOpsAdmin: true });
  });

  describe("given an operator has opened an organization in the Back office", () => {
    describe("when they enter a max dataset file size of 100 MB and save", () => {
      /** @scenario "The organization drawer offers the max dataset file size" */
      it("updates the organization with 100 MB", () => {
        openDrawer();

        expect(screen.getByLabelText(FIELD)).toHaveValue(null);
        expect(screen.getByText(/Leave empty for the default of 20 MB/)).toBeInTheDocument();

        enterAndSave("100");

        expect(mutate).toHaveBeenCalledWith(
          { id: "org-acme", data: { datasetAttachmentMaxMb: 100 } },
          expect.anything(),
        );
      });

      it("shows a stored value and saves no limit once it is cleared", () => {
        openDrawer(250);

        expect(screen.getByLabelText(FIELD)).toHaveValue(250);

        enterAndSave("");

        expect(mutate).toHaveBeenCalledWith(
          { id: "org-acme", data: { datasetAttachmentMaxMb: null } },
          expect.anything(),
        );
      });
    });

    describe("when they enter a max dataset file size outside the allowed range and save", () => {
      /** @scenario "The organization drawer refuses a max dataset file size outside the allowed range" */
      it.each(["19", "1025", "20.5"])(
        "shows the allowed range for %s and sends nothing",
        (value) => {
          const { onClose } = openDrawer();

          enterAndSave(value);

          expect(screen.getByText(RANGE)).toBeInTheDocument();
          expect(mutate).not.toHaveBeenCalled();
          expect(onClose).not.toHaveBeenCalled();
        },
      );

      it("shows a refusal from the server for that field on the field", () => {
        openDrawer();
        enterAndSave("100");

        act(() => {
          mutate.mock.calls[0]?.[1].onError({
            code: "validation_error",
            meta: {
              fieldErrors: { datasetAttachmentMaxMb: ["Enter a value the server accepts."] },
            },
          });
        });

        expect(screen.getByText("Enter a value the server accepts.")).toBeInTheDocument();
        expect(host.recording.failures).toEqual([]);
      });
    });
  });
});
