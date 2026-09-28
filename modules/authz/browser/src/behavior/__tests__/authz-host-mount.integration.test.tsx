// @vitest-environment jsdom
/**
 * The port answered every organization's plan with a hard-coded "not Enterprise".
 * Spec: specs/ui/module-host-mounting.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "org-1";

type UsageAnswer = { data?: { activePlan: { type: string } }; isLoading: boolean };

const usage = vi.fn((): UsageAnswer => ({ isLoading: true }));
const usageOptions = vi.fn();
vi.mock("../authz-api.ts", () => ({
  authzApi: {
    limits: {
      getUsage: {
        useQuery: (input: unknown, options: unknown) => {
          usageOptions(input, options);
          return usage();
        },
      },
    },
  },
}));

import { useAuthzHost } from "../../model/authz-host.ts";
import AuthzHostMount from "../authz-host-mount.tsx";

class TestScope extends UiScope {
  constructor(private readonly reading: UiActiveScope) {
    super();
  }

  activeScope(): UiActiveScope {
    return this.reading;
  }
}

class GrantedSession extends UiSession {
  constructor(private readonly grants: readonly string[]) {
    super();
  }

  currentUser() {
    return null;
  }

  hasPermission(permission: string): boolean {
    return this.grants.includes(permission);
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return false;
  }
}

function harness({ grants }: { grants: readonly string[] }) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new GrantedSession(grants),
    ),
    scope: new TestScope({ organizationId: ORGANIZATION_ID, projectId: null }),
  };

  return function Harness({ children }: { children: ReactNode }) {
    return (
      <UiCapabilityContextProvider value={capabilities}>
        <AuthzHostMount>{children}</AuthzHostMount>
      </UiCapabilityContextProvider>
    );
  };
}

/** Stands in for the roles and role-bindings pages, which branch on exactly this reading. */
function PlanReader() {
  const plan = useAuthzHost().plan();

  return (
    <div>
      <span data-testid="enterprise">{String(plan.isEnterprise)}</span>
      <span data-testid="loading">{String(plan.isLoading)}</span>
    </div>
  );
}

describe("given an authz host above the roles pages", () => {
  beforeEach(() => {
    usage.mockReset();
    usageOptions.mockReset();
  });

  describe("when the organization's plan answers Enterprise", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    /** @scenario An Enterprise organization's plan reaches the roles page */
    it("reports the organization as Enterprise rather than showing the pitch", () => {
      usage.mockReturnValue({ data: { activePlan: { type: "ENTERPRISE" } }, isLoading: false });

      render(<PlanReader />, { wrapper: harness({ grants: ["organization:view"] }) });

      expect(screen.getByTestId("enterprise")).toHaveTextContent("true");
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
      expect(usageOptions).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID },
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  describe("when the organization's plan answers a free tier", () => {
    it("reports the organization as not Enterprise", () => {
      usage.mockReturnValue({ data: { activePlan: { type: "FREE" } }, isLoading: false });

      render(<PlanReader />, { wrapper: harness({ grants: ["organization:view"] }) });

      expect(screen.getByTestId("enterprise")).toHaveTextContent("false");
    });
  });

  describe("when the plan has not answered yet", () => {
    it("reports still-arriving rather than not Enterprise", () => {
      usage.mockReturnValue({ isLoading: true });

      render(<PlanReader />, { wrapper: harness({ grants: ["organization:view"] }) });

      expect(screen.getByTestId("loading")).toHaveTextContent("true");
    });
  });

  describe("when the reader may not view the organization", () => {
    it("never asks for the plan", () => {
      usage.mockReturnValue({ isLoading: false });

      render(<PlanReader />, { wrapper: harness({ grants: [] }) });

      expect(usageOptions).toHaveBeenCalledWith(
        { organizationId: ORGANIZATION_ID },
        expect.objectContaining({ enabled: false }),
      );
    });
  });
});
