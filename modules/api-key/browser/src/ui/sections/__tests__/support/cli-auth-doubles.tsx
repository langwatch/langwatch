/**
 * Doubles for the CLI authorize screen's dependencies over one state each test seeds. The
 * suites load the module builders from inside `vi.mock` factories and the state at top level:
 * both reach the same instance.
 */

import { vi } from "vitest";

import { fakeGrantableHook } from "./fake-grantable.ts";

type Scope = { scopeType: string; scopeId: string };

export const cliAuthState = {
  bindings: [] as { scopeType: string; scopeId: string; role: string }[],
  bindingsLoading: false,
  bindingsFailed: false,
  ceilingLoading: false,
  firstMessage: void 0 as boolean | undefined,
};

export function resetCliAuthState(): void {
  cliAuthState.bindings = [];
  cliAuthState.bindingsLoading = false;
  cliAuthState.bindingsFailed = false;
  cliAuthState.ceilingLoading = false;
  cliAuthState.firstMessage = void 0;
}

/** The ceiling is the server's answer; faked here over the seeded bindings. */
export function grantablePermissionsModule() {
  const answer = fakeGrantableHook({
    bindings: () => cliAuthState.bindings,
    projectTeams: { "proj-1": "team-1", "proj-2": "team-2", "proj-personal": "team-personal" },
  });
  return {
    useGrantablePermissions: (input: Parameters<typeof answer>[0]) =>
      cliAuthState.ceilingLoading
        ? { permissions: [], isLoading: true, isError: false, refetch: () => undefined }
        : answer(input),
  };
}

export function apiKeyApiModule() {
  return {
    apiKeyApi: {
      useUtils: () => ({ apiKey: { list: { invalidate: vi.fn() } } }),
      apiKey: {
        myBindings: {
          useQuery: () => ({
            data: cliAuthState.bindings,
            isLoading: cliAuthState.bindingsLoading,
            isError: cliAuthState.bindingsFailed,
          }),
        },
      },
      project: {
        getHasFirstMessage: {
          useQuery: () => ({
            data: { firstMessage: cliAuthState.firstMessage ?? true },
            refetch: async () => undefined,
          }),
        },
      },
      organization: { getAll: { useQuery: () => ({ data: [] }) } },
    },
  };
}

export function traceClientModule() {
  return {
    traceClient: { traces: { onTraceUpdate: { useSubscription: () => undefined } } },
  };
}

/**
 * The picker has its own suite; these suites are about which scopes the SCREEN preselects and
 * sends, so the picker renders its value and offers one way to change it.
 */
export function scopeChipPickerModule() {
  return {
    ScopeChipPicker: ({
      value,
      onChange,
    }: {
      value: Scope[];
      onChange: (next: Scope[]) => void;
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
  };
}
