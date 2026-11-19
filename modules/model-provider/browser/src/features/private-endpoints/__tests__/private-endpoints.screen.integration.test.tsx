/**
 * @vitest-environment jsdom
 * Spec: specs/security/org-private-model-endpoints.feature
 */

import type { OrganizationPrivateModelEndpoint } from "@langwatch/model-provider-contract";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";

type Callbacks = { onSuccess: () => void; onError: (error: unknown) => void };

const { state, bind, rebind, unbind } = vi.hoisted(() => ({
  state: { endpoints: [] as unknown[] },
  bind: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
  rebind: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
  unbind: vi.fn<(input: unknown, callbacks: Callbacks) => void>(),
}));

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({
      privateModelEndpoint: { listForOrganization: { invalidate: () => Promise.resolve() } },
    }),
    privateModelEndpoint: {
      listForOrganization: {
        useQuery: () => ({ data: state.endpoints, isLoading: false }),
      },
      bind: { useMutation: () => ({ mutate: bind, isPending: false }) },
      rebind: { useMutation: () => ({ mutate: rebind, isPending: false }) },
      unbind: { useMutation: () => ({ mutate: unbind, isPending: false }) },
    },
  },
}));

const { default: PrivateEndpointsScreen } =
  await import("../ui/sections/private-endpoints.screen.tsx");

const INFERENCE: OrganizationPrivateModelEndpoint = {
  id: "pme_inference",
  name: "Inference",
  region: "eu-west-1",
  status: "in_use",
  bindings: [{ id: "pmb_1", endpointId: "pme_inference", hostname: "llm.internal.acme.test" }],
};

/** Even a row that arrived carrying addresses must not show them. */
const INFERENCE_WITH_ADDRESSES = { ...INFERENCE, addresses: ["10.20.1.21", "10.20.2.34"] };

function renderScreen() {
  return renderWithModelProviderHost(
    <PrivateEndpointsScreen />,
    new FakeModelProviderHost({ grants: new Set(["organization:manage"]) }),
  );
}

describe("Feature: Private model endpoints in organization settings", () => {
  beforeEach(() => {
    state.endpoints = [INFERENCE_WITH_ADDRESSES];
    bind.mockReset();
    rebind.mockReset();
    unbind.mockReset();
  });

  afterEach(() => cleanup());

  describe("given an organization manager opens private endpoints", () => {
    /** @scenario "The settings page shows endpoints without their addresses" */
    it("shows the endpoint's name, region, status and hostnames, and no address", () => {
      renderScreen();

      expect(screen.getByText("Inference")).toBeInTheDocument();
      expect(screen.getByText("eu-west-1")).toBeInTheDocument();
      expect(screen.getByText("In use")).toBeInTheDocument();
      expect(screen.getByText("llm.internal.acme.test")).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("10.20.1.21");
      expect(document.body.textContent).not.toContain("10.20.2.34");
    });

    it("explains that staff set endpoints up when there are none", () => {
      state.endpoints = [];
      renderScreen();

      expect(screen.getByText(/LangWatch staff set up private endpoints on request/)).toBeVisible();
    });
  });

  describe("when the manager adds a hostname to an endpoint", () => {
    async function addHostname(hostname: string) {
      renderScreen();
      fireEvent.click(screen.getByRole("button", { name: "Add a hostname to Inference" }));
      fireEvent.change(await screen.findByLabelText("Hostname"), { target: { value: hostname } });
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    }

    it("binds exactly the organization, the endpoint and the hostname", async () => {
      await addHostname(" llm.acme.test ");

      expect(bind).toHaveBeenCalledTimes(1);
      expect(bind.mock.calls[0]?.[0]).toStrictEqual({
        organizationId: "org-1",
        endpointId: "pme_inference",
        hostname: "llm.acme.test",
      });
    });

    it("shows the server's refusal under the hostname", async () => {
      await addHostname("acme");

      act(() => {
        bind.mock.calls[0]?.[1].onError({
          code: "validation_error",
          meta: { fieldErrors: { hostname: ["Enter a full hostname, such as llm.example.com."] } },
        });
      });

      expect(screen.getByText("Enter a full hostname, such as llm.example.com.")).toBeVisible();
    });
  });
});
