/**
 * @vitest-environment jsdom
 * The authorize mount wraps every page, so it reads grants only when a token is minted.
 * Spec: specs/frontend/session-permission-reads.feature
 */
import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { standing, mint } = vi.hoisted(() => ({
  standing: {
    options: [] as unknown[],
    refetch: vi.fn(
      async (): Promise<{ data?: { permissions: string[] }; error?: Error | null }> => ({
        data: { permissions: [] },
      }),
    ),
  },
  mint: vi.fn(async () => ({ token: "pat_1" })),
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUiHostServices: () => ({
    session: { currentUser: () => ({ id: "user_1" }), isSettled: () => true },
    navigation: { navigate: vi.fn(), replace: vi.fn() },
    feedback: { succeeded: vi.fn(), failed: vi.fn() },
  }),
  useUiScope: () => ({ activeScope: () => ({ organizationId: "org_1", projectId: "proj_1" }) }),
}));
vi.mock("@langwatch/browser-host/lent", () => ({ useLent: () => void 0 }));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: "/", search: "" }) }));
vi.mock("../api-key-organization-graph.ts", () => ({
  useApiKeyOrganizationGraph: () => ({ activeProject: void 0 }),
}));
vi.mock("../api-key-api.ts", () => ({
  apiKeyApi: {
    authz: {
      effectivePermissions: {
        useQuery: (_input: unknown, options: unknown) => {
          standing.options.push(options);
          return { data: void 0, refetch: standing.refetch };
        },
      },
    },
    apiKey: {
      create: { useMutation: () => ({ mutateAsync: mint, reset: vi.fn() }) },
      mintDocsSessionKey: { useMutation: () => ({ mutateAsync: vi.fn(), reset: vi.fn() }) },
    },
  },
}));

import { useAuthorizeHost, type AuthorizeHostApi } from "../../model/authorize-host.ts";
import { cappedDeviceFlowPermissions } from "../../model/project-token-input.ts";
import AuthorizeHostMount from "../authorize-host-mount.tsx";

afterEach(() => {
  cleanup();
  standing.options.length = 0;
  standing.refetch.mockClear();
  mint.mockClear();
});

function mountHost(): { host: () => AuthorizeHostApi } {
  let host: AuthorizeHostApi | undefined;
  function Capture() {
    host = useAuthorizeHost();
    return null;
  }
  render(
    <AuthorizeHostMount>
      <Capture />
    </AuthorizeHostMount>,
  );
  return { host: () => host! };
}

describe("AuthorizeHostMount", () => {
  describe("when a page renders under it", () => {
    /** @scenario "A page load reads the person's grants once" */
    it("sends no grant read of its own", () => {
      mountHost();

      expect(standing.options.length).toBeGreaterThan(0);
      expect(
        standing.options.every((options) => (options as { enabled?: boolean }).enabled === false),
      ).toBe(true);
      expect(standing.refetch).not.toHaveBeenCalled();
    });
  });

  describe("when a project token is minted", () => {
    /** @scenario "A page load reads the person's grants once" */
    it("reads the grants then and caps the token at them", async () => {
      const held = defaultCliKeyPermissions();
      standing.refetch.mockResolvedValueOnce({ data: { permissions: [...held] } });
      const { host } = mountHost();

      await expect(host().mintProjectToken({ expiresAt: void 0 })).resolves.toBe("pat_1");

      expect(standing.refetch).toHaveBeenCalledTimes(1);
      expect(mint).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: cappedDeviceFlowPermissions({ held }) }),
      );
    });

    /** @scenario "A page load reads the person's grants once" */
    it("reports a failed grant read as that failure, not as missing permissions", async () => {
      const failure = new Error("grant read failed");
      standing.refetch.mockResolvedValueOnce({ data: void 0, error: failure });
      const { host } = mountHost();

      await expect(host().mintProjectToken({ expiresAt: void 0 })).rejects.toBe(failure);

      expect(mint).not.toHaveBeenCalled();
    });
  });
});
