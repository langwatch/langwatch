/**
 * @vitest-environment jsdom
 * What the create drawer's failure notice carries once it has been presented: the real drawer,
 * the real gateway toaster, and the browser host's own presentation onto a captured toaster.
 * Spec: modules/gateway/specs/gateway-virtual-key-create-feedback.feature
 */
import { BrowserUiFeedback, type UiToaster } from "@langwatch/browser-host/feedback";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { VirtualKeyCreateDrawer } from "../ui/sections/virtual-key-create-drawer.tsx";

const ORG_ID = "org-acme";
const PROJECT_ID = "project-web-app";
const TRACE_ID = "0e761a4e50c7fa4eb873f5cd96e146fc";

const { createMutateAsync } = vi.hoisted(() => ({ createMutateAsync: vi.fn() }));

vi.mock("../../../behavior/gateway-api.ts", () => ({
  api: {
    useUtils: () => ({ virtualKeys: { list: { invalidate: async () => undefined } } }),
    virtualKeys: {
      create: { useMutation: () => ({ mutateAsync: createMutateAsync, isPending: false }) },
      applicableBudgets: { useQuery: () => ({ data: [] }) },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({
          data: [
            {
              id: "mp-openai",
              name: "OpenAI",
              provider: "openai",
              enabled: true,
              scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
              models: ["gpt-5-mini"],
            },
          ],
          isLoading: false,
        }),
      },
    },
    routingPolicy: {
      list: { useQuery: () => ({ data: [] }) },
      personalContext: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  organization: {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
    teams: [
      {
        id: "team-platform",
        name: "platform",
        projects: [{ id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: "team-platform" }],
      },
    ],
  },
  currentUser: { id: "user-1", name: "Ada", email: "ada@acme.test" },
});

type Toast = Parameters<UiToaster["create"]>[0];

/** The drawer's failure, presented the way the application presents it, onto a captured toaster. */
function presentedFailures(): Toast[] {
  const toasts: Toast[] = [];
  const feedback = BrowserUiFeedback.create({ create: (toast) => void toasts.push(toast) });
  for (const failure of host.recording.failures) feedback.failed(failure);
  return toasts;
}

const createKey = async () => {
  renderWithGatewayHost(
    <VirtualKeyCreateDrawer
      organizationId={ORG_ID}
      open
      onOpenChange={() => undefined}
      onCreated={() => undefined}
    />,
    { host },
  );
  await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "prod-openai");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(host.recording.failures).toHaveLength(1));
};

describe("given a create request that fails", () => {
  beforeEach(() => {
    createMutateAsync.mockReset();
    host.recording.failures.length = 0;
  });

  afterEach(() => cleanup());

  describe("when the response carries a trace id", () => {
    const internal = Object.assign(
      new Error('Invalid `prisma.virtualKey.create()` invocation: secret "vk-lw-leak"'),
      { data: { traceId: TRACE_ID, httpStatus: 500 } },
    );

    /** @scenario A create failure that carries a trace id offers it with the notice */
    it("retains the failure and presents its trace id with the fallback wording", async () => {
      createMutateAsync.mockRejectedValueOnce(internal);

      await createKey();

      expect(host.recording.failures[0]?.error).toBe(internal);
      const [toast] = presentedFailures();
      expect(toast?.title).toBe("Failed to create virtual key");
      expect(toast?.meta?.traceId).toBe(TRACE_ID);
      const shown = `${toast?.title} ${toast?.description ?? ""}`;
      expect(shown).not.toContain("prisma");
      expect(shown).not.toContain("vk-lw-leak");
      expect(shown).not.toContain(TRACE_ID);
    });
  });

  describe("when the server refuses with a code the registry knows", () => {
    /** @scenario A known refusal keeps the registry's guidance and still carries the trace id */
    it("reads the registry's wording and carries the trace id", async () => {
      createMutateAsync.mockRejectedValueOnce(
        Object.assign(new Error("trace_project_required: pick one"), {
          data: {
            traceId: TRACE_ID,
            error: { code: "trace_project_required", httpStatus: 400 },
          },
        }),
      );

      await createKey();

      const [toast] = presentedFailures();
      expect(toast?.title).toBe("This key needs somewhere for its traces to land");
      expect(toast?.description).toContain("Ownership");
      expect(toast?.meta?.traceId).toBe(TRACE_ID);
    });
  });

  describe("when nothing answered at all", () => {
    /** @scenario A create that never reached the server shows no error id */
    it("reads as waiting for the server and carries no error id", async () => {
      createMutateAsync.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await createKey();

      const [toast] = presentedFailures();
      expect(toast?.title).toBe("Waiting for LangWatch");
      expect(toast?.meta?.traceId).toBeUndefined();
    });
  });

  describe("when the server refuses the expiry date", () => {
    it("keeps the complaint on the field and raises no notice", async () => {
      createMutateAsync.mockRejectedValueOnce({
        data: {
          traceId: TRACE_ID,
          error: {
            code: "virtual_key_expiry_in_past",
            httpStatus: 400,
            meta: { fieldErrors: { expiresAt: ["Pick a date in the future"] } },
          },
        },
      });
      renderWithGatewayHost(
        <VirtualKeyCreateDrawer
          organizationId={ORG_ID}
          open
          onOpenChange={() => undefined}
          onCreated={() => undefined}
        />,
        { host },
      );
      await userEvent.type(screen.getByPlaceholderText("e.g. codex-prod"), "prod-openai");
      await userEvent.selectOptions(screen.getByTestId("vk-expiration-preset"), "custom");
      await userEvent.type(await screen.findByTestId("vk-expiration-date"), "2030-08-20");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("Pick a date in the future")).toBeTruthy();
      expect(host.recording.failures).toHaveLength(0);
    });
  });
});
