/**
 * @vitest-environment jsdom
 *
 * `useUiOrganizationFacts` reads `limits.getUsage`'s Enterprise flag and its
 * own `isLoading` as two fields (specs/rbac/custom-role-permission-editing.feature)
 * — a still-arriving plan must never collapse into "not Enterprise", or a
 * paying customer flashes the sales pitch for one round trip.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { UiCapabilityContextProvider, type UiSessionPort } from "../ui-capabilities";
import { UiRpcContextProvider, type UiRpcPort } from "../ui-rpc";
import { useUiOrganizationFacts } from "../ui-organization-facts";

function stubSession(): UiSessionPort {
  return {
    currentUser: () => null,
    activeScope: () => ({ organizationId: "organization-1", projectId: null }),
    hasPermission: () => true,
    isSettled: () => true,
  } as UiSessionPort;
}

function stubRpc(planQuery: () => Promise<unknown>): UiRpcPort {
  return {
    query: (path: string) =>
      path === "limits.getUsage" ? planQuery() : Promise.resolve([]),
    mutate: vi.fn(),
    subscribe: vi.fn(),
  } as unknown as UiRpcPort;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <UiCapabilityContextProvider
        value={{
          documentTitle: { set: () => () => {} },
          feedback: { notify: vi.fn(), reportFailure: vi.fn() } as never,
          navigation: {} as never,
          route: {} as never,
          session: stubSession(),
        }}
      >
        {children}
      </UiCapabilityContextProvider>
    </QueryClientProvider>
  );
}

describe("given a plan question that has not answered yet", () => {
  /** @scenario "A plan still arriving is neither Enterprise nor refused" */
  it("reports isPlanLoading true and isEnterprise false, not one collapsed into the other", async () => {
    let resolvePlan!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolvePlan = resolve;
    });
    const rpc = stubRpc(() => pending);

    const { result } = renderHook(() => useUiOrganizationFacts(), {
      wrapper: ({ children }) => (
        <UiRpcContextProvider value={rpc}>{wrapper({ children })}</UiRpcContextProvider>
      ),
    });

    await waitFor(() => expect(result.current.isPlanLoading).toBe(true));
    expect(result.current.isEnterprise).toBe(false);

    resolvePlan({ activePlan: { type: "ENTERPRISE" } });
    await waitFor(() => expect(result.current.isEnterprise).toBe(true));
    expect(result.current.isPlanLoading).toBe(false);
  });
});
