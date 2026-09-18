import {
  UiCapabilityContextProvider,
  UiRpc,
  UiScope,
  UiSession,
  type UiRpcSubscription,
} from "@langwatch/browser-host/capabilities";
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

class StubSession extends UiSession {
  currentUser() {
    return null;
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

class StubScope extends UiScope {
  activeScope() {
    return { organizationId: "organization-1", projectId: null };
  }
}

function stubSession(): UiSession {
  return new StubSession();
}

function stubScope(): UiScope {
  return new StubScope();
}

class StubRpc extends UiRpc {
  constructor(private readonly planQuery: () => Promise<unknown>) {
    super();
  }

  query(path: string): Promise<unknown> {
    return path === "limits.getUsage" ? this.planQuery() : Promise.resolve([]);
  }

  mutate(): Promise<unknown> {
    return Promise.resolve();
  }

  subscribe(): UiRpcSubscription {
    return { unsubscribe: () => {} };
  }
}

function stubRpc(planQuery: () => Promise<unknown>): UiRpc {
  return new StubRpc(planQuery);
}

/**
 * `rpc` goes through the same capability context as `session` and `scope` —
 * record 10.1 rules out a context of `useUiRpc`'s own, so a stub is injected
 * here rather than through a (nonexistent) `UiRpcContextProvider`.
 */
function wrapper({ children, rpc }: { children: ReactNode; rpc: UiRpc }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <UiCapabilityContextProvider
        value={{
          documentTitle: { set: () => () => {} },
          feedback: { notify: vi.fn(), reportFailure: vi.fn() } as never,
          navigation: {} as never,
          route: {} as never,
          rpc,
          session: stubSession(),
          scope: stubScope(),
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
      wrapper: ({ children }) => wrapper({ children, rpc }),
    });

    await waitFor(() => expect(result.current.isPlanLoading).toBe(true));
    expect(result.current.isEnterprise).toBe(false);

    resolvePlan({ activePlan: { type: "ENTERPRISE" } });
    await waitFor(() => expect(result.current.isEnterprise).toBe(true));
    expect(result.current.isPlanLoading).toBe(false);
  });
});
