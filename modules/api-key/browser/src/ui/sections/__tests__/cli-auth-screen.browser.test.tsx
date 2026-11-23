/**
 * The approval page's actions on a phone-width viewport, measured in a real engine: jsdom
 * reports zero for every box, so only here can Approve and Deny be compared by height.
 * Spec: login-user-scoped-key.feature
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing.tsx";
import CliAuthScreen from "../cli-auth-screen.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    bindings: [] as { scopeType: string; scopeId: string; role: string }[],
    bindingsLoading: false,
    bindingsFailed: false,
    ceilingLoading: false,
    firstMessage: void 0 as boolean | undefined,
  },
}));

// The ceiling is the server's answer; faked here over the seeded bindings.
vi.mock("../../../behavior/use-grantable-permissions.ts", async () => {
  const { fakeGrantableHook } = await import("./support/fake-grantable.ts");
  const answer = fakeGrantableHook({
    bindings: () => state.bindings,
    projectTeams: { "proj-1": "team-1", "proj-2": "team-2", "proj-personal": "team-personal" },
  });
  return {
    useGrantablePermissions: (input: Parameters<typeof answer>[0]) =>
      state.ceilingLoading
        ? { permissions: [], isLoading: true, isError: false, refetch: () => undefined }
        : answer(input),
  };
});

vi.mock("../../../behavior/api-key-api.ts", () => ({
  apiKeyApi: {
    useUtils: () => ({ apiKey: { list: { invalidate: vi.fn() } } }),
    apiKey: {
      myBindings: {
        useQuery: () => ({
          data: state.bindings,
          isLoading: state.bindingsLoading,
          isError: state.bindingsFailed,
        }),
      },
    },
    project: {
      getHasFirstMessage: {
        useQuery: () => ({
          data: { firstMessage: state.firstMessage ?? true },
          refetch: async () => undefined,
        }),
      },
    },
    organization: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

vi.mock("@langwatch/trace-client", () => ({
  traceClient: { traces: { onTraceUpdate: { useSubscription: () => undefined } } },
}));

// The picker is `@langwatch/design-system`'s and has its own suite; what this file
// is about is which scopes the SCREEN preselects and sends, so the picker
// renders its value and offers one way to change it.
vi.mock("@langwatch/design-system/scope-chip-picker", () => ({
  ScopeChipPicker: ({
    value,
    onChange,
  }: {
    value: { scopeType: string; scopeId: string }[];
    onChange: (next: { scopeType: string; scopeId: string }[]) => void;
  }) => (
    <div>
      <span data-testid="selected-scopes">
        {value.map((entry) => `${entry.scopeType}:${entry.scopeId}`).join(",")}
      </span>
      <button data-testid="clear-scopes" aria-label="Clear scopes" onClick={() => onChange([])} />
      <button
        data-testid="pick-personal"
        aria-label="Pick the personal project"
        onClick={() => onChange([{ scopeType: "PROJECT", scopeId: "proj-personal" }])}
      />
    </div>
  ),
}));

const ORG_WITH_TEAMS = [
  {
    id: "org-1",
    name: "ACME",
    teams: [
      {
        id: "team-1",
        name: "Platform",
        isPersonal: false,
        projects: [{ id: "proj-1", name: "Web App", slug: "web-app" }],
      },
      {
        id: "team-2",
        name: "Growth",
        isPersonal: false,
        projects: [{ id: "proj-2", name: "Growth App", slug: "growth-app" }],
      },
      {
        id: "team-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: "user-1",
        projects: [
          {
            id: "proj-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: "user-1",
          },
        ],
      },
    ],
  },
];

function hostFor(options: Partial<ConstructorParameters<typeof FakeApiKeyHost>[0]> = {}) {
  return new FakeApiKeyHost({
    query: { user_code: "WDJB-MJHT" },
    organizations: ORG_WITH_TEAMS,
    ...options,
  });
}

afterEach(() => cleanup());

function heightOf(name: string): number {
  return screen.getByRole("button", { name }).getBoundingClientRect().height;
}

describe("given a pending device code on a phone", () => {
  /** @scenario the primary action and Deny are the same height on a phone */
  it("draws Confirm, then Approve, as tall as Deny while the actions stack", async () => {
    const user = userEvent.setup();
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
    renderWithApiKeyHost(<CliAuthScreen />, hostFor());

    const confirm = await screen.findByRole("button", { name: "Confirm" });
    expect(window.innerWidth).toBeLessThan(480);
    expect(heightOf("Confirm")).toBeGreaterThan(0);
    expect(heightOf("Confirm")).toBe(heightOf("Deny"));

    await user.click(confirm);
    await screen.findByRole("button", { name: "Approve" });
    expect(heightOf("Approve")).toBeGreaterThan(0);
    expect(heightOf("Approve")).toBe(heightOf("Deny"));
  });
});
