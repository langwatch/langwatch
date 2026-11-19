/**
 * @vitest-environment jsdom
 * Spec: specs/security/org-private-model-endpoints.feature
 */
import { act, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost } from "../../../testing.tsx";
import { PrivateEndpointsSection } from "../ui/sections/private-endpoints-section.tsx";

type Callbacks = { onSuccess: () => void; onError: (error: unknown) => void };

const { state, register, update, remove } = vi.hoisted(() => ({
  state: { endpoints: [] as unknown[] },
  register: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
  update: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
  remove: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
}));

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useUtils: () => ({
      privateModelEndpoint: { listForStaff: { invalidate: () => Promise.resolve() } },
    }),
    privateModelEndpoint: {
      listForStaff: { useQuery: () => ({ data: state.endpoints, isLoading: false }) },
      register: { useMutation: () => ({ mutate: register, isPending: false }) },
      update: { useMutation: () => ({ mutate: update, isPending: false }) },
      remove: { useMutation: () => ({ mutate: remove, isPending: false }) },
    },
  },
}));

const INFERENCE = {
  id: "pme_inference",
  organizationId: "org-acme",
  name: "Inference",
  region: "eu-west-1",
  status: "in_use",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
  bindings: [{ id: "pmb_1", endpointId: "pme_inference", hostname: "llm.internal.acme.test" }],
};

function renderSection({ isOpsAdmin = true }: { isOpsAdmin?: boolean } = {}) {
  renderWithOpsHost(<PrivateEndpointsSection organizationId="org-acme" />, {
    host: fakeOpsHost({ isOpsAdmin }),
  });
}

async function registerWith({ addresses }: { addresses: string }) {
  renderSection();
  fireEvent.click(screen.getByRole("button", { name: "Register endpoint" }));
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Inference" } });
  fireEvent.change(screen.getByLabelText("Region"), { target: { value: "eu-west-1" } });
  fireEvent.change(screen.getByLabelText("Addresses"), { target: { value: addresses } });
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
}

describe("Feature: Staff manage an organization's private endpoints in ops", () => {
  beforeEach(() => {
    state.endpoints = [];
    register.mockReset();
    update.mockReset();
    remove.mockReset();
  });

  describe("given an organization with a private endpoint", () => {
    it("lets staff with ops:view only read it, with no way to register, edit or remove", () => {
      state.endpoints = [INFERENCE];
      renderSection({ isOpsAdmin: false });

      expect(screen.getByText("10.20.1.21, 10.20.2.34 on port 443")).toBeInTheDocument();
      for (const name of ["Register endpoint", "Edit", "Remove"]) {
        expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      }
    });

    it("shows its addresses, port, status and bound hostnames to staff", () => {
      state.endpoints = [INFERENCE];
      renderSection();

      expect(screen.getByText("10.20.1.21, 10.20.2.34 on port 443")).toBeInTheDocument();
      expect(screen.getByText("In use")).toBeInTheDocument();
      expect(screen.getByText("Hostnames: llm.internal.acme.test")).toBeInTheDocument();
    });
  });

  describe("when staff register an endpoint", () => {
    it("sends the addresses split on commas and new lines, on the default port", async () => {
      await registerWith({ addresses: "10.20.1.21,\n 10.20.2.34\n" });

      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0]?.[0]).toStrictEqual({
        organizationId: "org-acme",
        name: "Inference",
        region: "eu-west-1",
        addresses: ["10.20.1.21", "10.20.2.34"],
        port: 443,
      });
    });

    it("shows the server's refusal under the addresses", async () => {
      await registerWith({ addresses: "8.8.8.8" });

      act(() => {
        register.mock.calls[0]?.[1].onError({
          code: "validation_error",
          meta: { fieldErrors: { addresses: ["8.8.8.8 is not a private address."] } },
        });
      });

      expect(screen.getByText("8.8.8.8 is not a private address.")).toBeInTheDocument();
    });
  });
});
