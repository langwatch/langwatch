/**
 * @vitest-environment jsdom
 * The create drawer's side of the guided gateway tour: the actions it registers, the key it
 * mints for real, and the record the tour leaves for Langy.
 * Spec: specs/features/onboarding/guided-tour.feature
 */
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import {
  GuidedTourToken,
  type GuidedTourActions,
  type GuidedTourHooks,
} from "@langwatch/onboarding-contract";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { VirtualKeyCreateDrawer } from "../ui/sections/virtual-key-create-drawer.tsx";

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-web-app";

const world = vi.hoisted(() => ({
  create: vi.fn(),
  invalidateList: vi.fn(),
  listedNames: [] as string[],
  registered: { current: {} } as { current: Partial<GuidedTourActions> },
  recordReveal: vi.fn(),
  declarations: { current: undefined as UiDeclarations | undefined },
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => world.declarations.current,
}));

vi.mock("../../../behavior/gateway-api.ts", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: {
        list: {
          invalidate: world.invalidateList,
          getData: () => world.listedNames.map((name) => ({ name })),
        },
        applicableBudgets: { invalidate: async () => undefined },
      },
    }),
    virtualKeys: {
      create: {
        // react-query awaits the hook's onSuccess before mutateAsync answers.
        useMutation: (options?: { onSuccess?: (result: unknown) => unknown }) => ({
          mutateAsync: async (input: unknown) => {
            const result = await world.create(input);
            await options?.onSuccess?.(result);
            return result;
          },
          isPending: false,
        }),
      },
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
    routingPolicy: { list: { useQuery: () => ({ data: [] }) } },
    user: { personalContext: { useQuery: () => ({ data: undefined }) } },
  },
}));

const lentTour: GuidedTourHooks = {
  useRegisterActions: (actions) => {
    useEffect(() => {
      const registry = world.registered;
      registry.current = { ...actions };
      return () => {
        registry.current = {};
      };
    }, [actions]);
  },
  useRecordVirtualKeyReveal: () => world.recordReveal,
};

const host = fakeGatewayHost({
  permissions: ["virtualKeys:manage"],
  organization: {
    id: ORG_ID,
    name: "ACME",
    slug: "acme",
    teams: [
      {
        id: TEAM_ID,
        name: "platform",
        projects: [{ id: PROJECT_ID, name: "web-app", slug: "web-app", teamId: TEAM_ID }],
      },
    ],
  },
  currentUser: { id: "user-1", name: "Ada", email: "ada@acme.test" },
});

const onCreated = vi.fn();

const renderDrawer = () =>
  renderWithGatewayHost(
    <VirtualKeyCreateDrawer
      organizationId={ORG_ID}
      open
      onOpenChange={() => undefined}
      onCreated={onCreated}
    />,
    { host },
  );

const tourActions = (): Partial<GuidedTourActions> => world.registered.current;

const nameField = () => screen.getByPlaceholderText("e.g. codex-prod") as HTMLInputElement;

/** Types the key name through the registered action and waits for the last character. */
async function typeName(wanted: string) {
  act(() => tourActions().typeVirtualKeyName?.(wanted));
  await waitFor(() => expect(nameField().value).toBe(wanted), { timeout: 3000 });
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const MINTED = {
  virtualKey: { id: "vk-new", name: "production-app" },
  secret: "secret-marker",
  revealId: "reveal-1",
  preview: "preview-marker",
};

describe("given the gateway tour running on the virtual keys page", () => {
  beforeEach(() => {
    world.create.mockReset();
    world.create.mockResolvedValue(MINTED);
    world.invalidateList.mockReset();
    world.invalidateList.mockResolvedValue(undefined);
    world.recordReveal.mockReset();
    world.recordReveal.mockResolvedValue(undefined);
    world.listedNames = [];
    world.registered.current = {};
    onCreated.mockReset();
    world.declarations.current = uiDeclarations([
      {
        name: "onboarding",
        installation: { capabilities: {}, lends: [{ token: GuidedTourToken, value: lentTour }] },
      },
    ]);
  });

  afterEach(() => cleanup());

  describe("when the drawer is mounted", () => {
    it("registers the name and submit actions, and takes them back when it unmounts", () => {
      const { unmount } = renderDrawer();
      expect(tourActions().typeVirtualKeyName).toBeTypeOf("function");
      expect(tourActions().submitVirtualKeyCreate).toBeTypeOf("function");
      unmount();
      expect(tourActions().typeVirtualKeyName).toBeUndefined();
    });

    it("marks the name field and the Create button as tour targets", async () => {
      renderDrawer();
      await typeName("production-app");
      expect(nameField().getAttribute("data-tour")).toBe("vk-name");
      expect(
        screen.getByTestId("gateway-virtual-key-create-submit").getAttribute("data-tour"),
      ).toBe("vk-create");
    });
  });

  describe("when the organization already has a key named production-app", () => {
    /** @scenario a replay of the gateway tour never mints a duplicate key name */
    it("types the first name the listed keys do not carry", async () => {
      world.listedNames = ["production-app", "staging-app"];
      renderDrawer();
      await typeName("production-app-2");
      world.listedNames = ["production-app", "production-app-2"];
      act(() => tourActions().typeVirtualKeyName?.("production-app"));
      await waitFor(() => expect(nameField().value).toBe("production-app-3"), { timeout: 3000 });
    });
  });

  describe("when the tour submits the key through the registered action", () => {
    /** @scenario the submit action reports when the create has answered */
    it("hands back the create request, settled once the create has answered", async () => {
      const create = deferred<typeof MINTED>();
      world.create.mockReturnValue(create.promise);
      renderDrawer();
      await typeName("production-app");

      const settled = vi.fn();
      const submitted = tourActions().submitVirtualKeyCreate?.();
      void submitted?.then(settled);
      await waitFor(() => expect(world.create).toHaveBeenCalled());
      await act(async () => undefined);
      expect(settled).not.toHaveBeenCalled();

      create.resolve(MINTED);
      await submitted;
      expect(settled).toHaveBeenCalled();
    });

    /** @scenario the secret shows as soon as the create answers */
    it("hands the secret over while the list is still refreshing behind it", async () => {
      world.invalidateList.mockReturnValue(new Promise(() => undefined));
      renderDrawer();
      await typeName("production-app");

      await act(async () => {
        void tourActions().submitVirtualKeyCreate?.();
      });

      await waitFor(() =>
        expect(onCreated).toHaveBeenCalledWith(
          expect.objectContaining({ name: "production-app", secret: "secret-marker" }),
        ),
      );
      expect(world.invalidateList).toHaveBeenCalledWith({ organizationId: ORG_ID });
    });

    /** @scenario the tour's key is recorded for Langy by its reveal id */
    it("asks for a one-time reveal and records the key's name, preview and reveal id", async () => {
      renderDrawer();
      await typeName("production-app");

      await act(async () => {
        await tourActions().submitVirtualKeyCreate?.();
      });

      expect(world.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          name: "production-app",
          revealOnce: true,
        }),
      );
      expect(world.recordReveal).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        name: "production-app",
        preview: "preview-marker",
        revealId: "reveal-1",
      });
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ secret: "secret-marker" }));
    });

    /** @scenario the tour's action settles once the key is recorded */
    it("settles only after the record has answered, and a failed record still hands the secret over", async () => {
      const recorded = deferred<void>();
      world.recordReveal.mockReturnValue(recorded.promise);
      renderDrawer();
      await typeName("production-app");

      const settled = vi.fn();
      const submitted = tourActions().submitVirtualKeyCreate?.();
      void submitted?.then(settled);
      await waitFor(() => expect(world.recordReveal).toHaveBeenCalled());
      await act(async () => undefined);
      expect(settled).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();

      recorded.reject(new Error("refused"));
      await submitted;
      expect(settled).toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ secret: "secret-marker" }));
    });
  });

  describe("when a person creates a key by hand", () => {
    it("asks for no reveal and records nothing", async () => {
      renderDrawer();
      await userEvent.type(nameField(), "by-hand");
      await userEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(world.create).toHaveBeenCalled());
      expect(world.create.mock.calls[0]![0]).not.toHaveProperty("revealOnce");
      expect(world.recordReveal).not.toHaveBeenCalled();
    });
  });
});
