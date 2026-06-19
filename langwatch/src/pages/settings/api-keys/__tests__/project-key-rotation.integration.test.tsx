/**
 * @vitest-environment jsdom
 *
 * Integration tests for rotating the legacy project base API key from the
 * Settings > API Keys page (project-key-rotation.feature).
 *
 * The unified-keys rework removed the UI to rotate the project base/legacy
 * key. These tests cover restoring that control on the legacy "Project API
 * Key" row: it is permission-gated on `project:manage`, opens the reused
 * regenerate-confirm dialog, and drives the `project.regenerateApiKey`
 * mutation. A failed rotation surfaces an error toast. The success path
 * drives through `TokenCreatedDialog`, whose dynamic ShikiCommandBox import
 * is stubbed synchronously so the new key is assertable in jsdom.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeysSection } from "../ApiKeysSection";

// Stub dynamic() so TokenCreatedDialog's ShikiCommandBox renders synchronously:
// React.lazy (which next-dynamic wraps) always suspends for at least one async
// tick in jsdom, making the token text unassertable without this replacement.
vi.mock("~/utils/compat/next-dynamic", () => ({
  default: (_importFn: () => Promise<any>) =>
    function DynamicStub(props: Record<string, unknown>) {
      return <pre data-testid="shiki-box">{String(props.command ?? "")}</pre>;
    },
}));

// ---------------------------------------------------------------------------
// Router mock (no query params needed for these tests)
// ---------------------------------------------------------------------------
const mockRouterQuery: Record<string, string> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    pathname: "/settings/api-keys",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

// ---------------------------------------------------------------------------
// tRPC mock
// ---------------------------------------------------------------------------
const mockApiKeyList = vi.fn();

// The regenerateApiKey mutation: `regenerateMutate` is the spy the tests
// assert against; `regenerateImpl` lets a test swap in an onError-invoking
// implementation to exercise the failure path.
const regenerateMutate = vi.fn();
const regenerateImpl = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | ((
        vars: { projectId: string },
        opts: {
          onSuccess?: (res: { apiKey: string }) => void;
          onError?: (e: { message: string }) => void;
        },
      ) => void),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      apiKey: { list: { invalidate: vi.fn() } },
      organization: { getAll: { invalidate: vi.fn() } },
    }),
    apiKey: {
      list: { useQuery: () => mockApiKeyList() },
      myBindings: { useQuery: () => ({ data: [], isLoading: false }) },
      orgProjects: { useQuery: () => ({ data: [], isLoading: false }) },
      orgTeams: { useQuery: () => ({ data: [], isLoading: false }) },
      orgMembers: {
        useQuery: () => ({ data: [{ id: "u-1" }], isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
    project: {
      regenerateApiKey: {
        useMutation: () => ({
          mutate: (vars: { projectId: string }, opts: any) => {
            regenerateMutate(vars, opts);
            regenerateImpl.current?.(vars, opts);
          },
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: { BASE_HOST: "https://app.langwatch.ai" },
    isLoading: false,
  }),
}));

// Built once via vi.hoisted and returned by reference on every call — a fresh
// literal per call busts the useMemo([organization]) inside useAvailableScopes
// and hangs the worker. `project.apiKey` is mutated per test to toggle the
// legacy project-key row; `hasPermission` is parametrized per test.
const otpMocks = vi.hoisted(() => ({
  project: {
    id: "proj-1",
    name: "Project Alpha",
    apiKey: null as string | null,
  },
  canManage: true,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const organization = {
    id: "org-1",
    name: "Acme Corp",
    teams: [
      {
        id: "team-1",
        name: "Team Red",
        projects: [{ id: "proj-1", name: "Project Alpha" }],
      },
    ],
  };
  const team = { id: "team-1", name: "Team Red" };
  return {
    useOrganizationTeamProject: () => ({
      project: otpMocks.project,
      organization,
      team,
      hasPermission: (_permission: string) => otpMocks.canManage,
    }),
  };
});

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { toaster } from "~/components/ui/toaster";

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ApiKeysSection organizationId="org-1" projectId="proj-1" />
    </ChakraProvider>,
  );
}

const ROTATE_LABEL = "Rotate Project API Key";

describe("<ApiKeysSection /> project base key rotation", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockRouterQuery)) delete mockRouterQuery[k];
    otpMocks.project.apiKey = "sk-lw-legacybasekeysecretabcd";
    otpMocks.canManage = true;
    regenerateImpl.current = undefined;
    vi.clearAllMocks();
    mockApiKeyList.mockReturnValue({ data: [], isLoading: false });
  });
  afterEach(() => cleanup());

  describe("given a legacy project key and permission to manage the project", () => {
    describe("when viewing the legacy project key row", () => {
      /** @scenario An admin rotates the base key and sees the new key once */
      it("offers a control to rotate the project base API key", () => {
        renderSection();
        expect(
          screen.getByRole("button", { name: ROTATE_LABEL }),
        ).toBeInTheDocument();
      });
    });

    describe("when clicking the rotate control", () => {
      /** @scenario An admin rotates the base key and sees the new key once */
      it("opens the regenerate confirmation dialog", async () => {
        const user = userEvent.setup();
        renderSection();
        await user.click(screen.getByRole("button", { name: ROTATE_LABEL }));
        expect(
          await screen.findByText("Regenerate API Key?"),
        ).toBeInTheDocument();
      });
    });

    describe("when confirming the rotation", () => {
      /** @scenario An admin rotates the base key and sees the new key once */
      it("calls the regenerate mutation with the project id", async () => {
        const user = userEvent.setup();
        renderSection();
        await user.click(screen.getByRole("button", { name: ROTATE_LABEL }));
        await user.click(
          await screen.findByRole("button", { name: "Regenerate Key" }),
        );
        expect(regenerateMutate).toHaveBeenCalledWith(
          { projectId: "proj-1" },
          expect.anything(),
        );
      });
    });

    describe("when the rotation succeeds", () => {
      /** @scenario "An admin rotates the base key and sees the new key once" */
      it("reveals the new key in the Token Created dialog", async () => {
        regenerateImpl.current = (_vars, opts) => {
          opts.onSuccess?.({ apiKey: "sk-lw-newrotatedkey1234" });
        };
        const user = userEvent.setup();
        renderSection();
        await user.click(screen.getByRole("button", { name: ROTATE_LABEL }));
        await user.click(
          await screen.findByRole("button", { name: "Regenerate Key" }),
        );

        // TokenCreatedDialog opens and the new key appears in at least one snippet
        expect(await screen.findByText("Token Created")).toBeInTheDocument();
        const keyElements = await screen.findAllByText(
          /sk-lw-newrotatedkey1234/,
        );
        expect(keyElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe("given a legacy project key but no permission to manage the project", () => {
    beforeEach(() => {
      otpMocks.canManage = false;
    });

    describe("when viewing the legacy project key row", () => {
      /** @scenario Rotation requires permission to manage the project */
      it("does not offer a control to rotate the project base API key", () => {
        renderSection();
        expect(
          screen.queryByRole("button", { name: ROTATE_LABEL }),
        ).not.toBeInTheDocument();
      });

      // The legacy row intentionally has no edit or revoke control — rotation
      // is the only mutating affordance, and only when permitted.
      /** @scenario "The base key keeps working until it is explicitly rotated" */
      it("does not offer edit or revoke controls on the legacy row", () => {
        renderSection();
        expect(screen.getByText("Project API Key")).toBeInTheDocument();
        expect(
          screen.queryByRole("button", {
            name: /Edit API key Project API Key/,
          }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", {
            name: /Revoke API key Project API Key/,
          }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the rotation request fails", () => {
    describe("when confirming the rotation", () => {
      /** @scenario A failed rotation leaves the previous base key working */
      it("shows an error toast explaining the rotation did not happen", async () => {
        regenerateImpl.current = (_vars, opts) => {
          opts.onError?.({ message: "boom" });
        };
        const user = userEvent.setup();
        renderSection();
        await user.click(screen.getByRole("button", { name: ROTATE_LABEL }));
        await user.click(
          await screen.findByRole("button", { name: "Regenerate Key" }),
        );

        expect(toaster.create).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error" }),
        );
      });
    });
  });
});
