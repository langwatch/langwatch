import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { UiCapabilityContextProvider, UiSessionPort } from "../capabilities.ts";
import type { UiSessionSnapshot } from "../session.ts";
import { useSession } from "../session.ts";
import { createUiCapabilitiesFromHost } from "../testing.ts";

const host = { route: () => ({ params: {}, query: {} }), navigate: () => {} };

describe("the shared UI session reading", () => {
  it("reads the capability root's published snapshot", () => {
    const reading: UiSessionSnapshot = {
      session: { status: "anonymous", user: null },
      scope: { status: "ready", organization: undefined, team: undefined, project: undefined },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
    const { result } = renderHook(() => useSession(), { wrapper: withSession(reading) });
    expect(result.current).toEqual({ status: "anonymous", user: null });
  });

  it("refuses when the capability root is absent", () => {
    expect(() => renderHook(() => useSession())).toThrow(/UI capabilities/);
  });
});

function withSession(reading: UiSessionSnapshot) {
  const session = new SnapshotSession(reading);
  return function SessionProvider({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={createUiCapabilitiesFromHost(host, session)}>
        {children}
      </UiCapabilityContextProvider>
    );
  };
}

class SnapshotSession extends UiSessionPort {
  constructor(private readonly reading: UiSessionSnapshot) {
    super();
  }
  currentUser() {
    return this.reading.session.user;
  }
  activeScope() {
    return { organizationId: null, projectId: null };
  }
  hasPermission() {
    return false;
  }
  isSettled() {
    return false;
  }
  featureFlag() {
    return undefined;
  }
  override snapshot() {
    return this.reading;
  }
}
