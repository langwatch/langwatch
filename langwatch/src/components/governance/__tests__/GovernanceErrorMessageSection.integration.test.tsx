/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const mutate = vi.fn();
const invalidate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ sessionPolicy: { get: { invalidate } } }),
    sessionPolicy: {
      get: {
        useQuery: () => ({
          data: { accountErrorMessage: "", maxSessionDurationDays: 0, contentMode: "full" },
          isLoading: false,
        }),
      },
      setAccountErrorMessage: {
        useMutation: () => ({ mutate, isPending: false }),
      },
    },
  },
}));

import {
  GovernanceErrorMessageSection,
  containsBillingTriggerPhrase,
} from "../GovernanceErrorMessageSection";

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <GovernanceErrorMessageSection organizationId="org_1" />
    </ChakraProvider>,
  );
}

function typeMessage(text: string) {
  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: text } });
}

const TRIGGER_WARNING = /replace your message with\s+their own billing link/i;

describe("GovernanceErrorMessageSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the admin types a message containing a billing trigger phrase", () => {
    /** @scenario Admin is warned when a custom governance message contains a provider billing trigger phrase */
    it("shows the billing-trigger warning so the message is not silently overridden", () => {
      renderSection();

      typeMessage("Your credit balance is too low, add funds.");

      expect(screen.getByText(TRIGGER_WARNING)).toBeInTheDocument();
    });

    it("also warns on the word 'billing'", () => {
      renderSection();

      typeMessage("Contact billing to resolve this.");

      expect(screen.getByText(TRIGGER_WARNING)).toBeInTheDocument();
    });
  });

  describe("when the admin types a trigger-safe governance message", () => {
    it("shows no warning for quota/limit wording", () => {
      renderSection();

      typeMessage(
        "Your organization's AI gateway quota is exhausted. Contact your LangWatch admin to raise the limit.",
      );

      expect(screen.queryByText(TRIGGER_WARNING)).not.toBeInTheDocument();
    });

    it("shows no warning when the field is empty", () => {
      renderSection();

      expect(screen.queryByText(TRIGGER_WARNING)).not.toBeInTheDocument();
    });
  });

  describe("when the admin saves a message", () => {
    it("calls the setAccountErrorMessage mutation with the typed value", () => {
      renderSection();

      typeMessage("Spending limit reached, contact your admin.");
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      expect(mutate).toHaveBeenCalledWith({
        organizationId: "org_1",
        message: "Spending limit reached, contact your admin.",
      });
    });
  });
});

describe("containsBillingTriggerPhrase", () => {
  describe("when the message mentions credit or billing", () => {
    it.each(["credit balance too low", "update your BILLING", "Credit issue"])(
      "flags %j as a trigger phrase",
      (message) => {
        expect(containsBillingTriggerPhrase(message)).toBe(true);
      },
    );
  });

  describe("when the message uses governance-safe wording", () => {
    it.each([
      "quota exhausted, contact your admin",
      "spending limit reached",
      "access is currently blocked",
      "",
    ])("does not flag %j", (message) => {
      expect(containsBillingTriggerPhrase(message)).toBe(false);
    });
  });
});
