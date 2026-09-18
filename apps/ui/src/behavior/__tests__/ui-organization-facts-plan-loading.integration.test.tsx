import { UiCapabilityContextProvider, UiSession } from "@langwatch/browser-host/capabilities";
/**
 * Prevents a loading plan from being read as "not Enterprise", which would show the sales
 * pitch to paying customers (specs/rbac/custom-role-permission-editing.feature).
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useUiOrganizationFacts } from "../ui-organization-facts";
import { UiRpcContextProvider, type UiRpc } from "../ui-rpc";

class StubSession extends UiSession {
  currentUser() {
    return null;
  }
  activeScope() {
    return { organizationId: "organization-1", projectId: null };
  }
  hasPermission(): boolean {
    return true;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return false;
  }
}

function stubSession(): UiSession {
  return new StubSession();
}

function stubRpc(planQuery: () => Promise<unknown>): UiRpc {
  return {
    query: (path: string) => (path === "limits.getUsage" ? planQuery() : Promise.resolve([])),
    mutate: vi.fn(),
    subscribe: vi.fn(),
  } as unknown as UiRpc;
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
