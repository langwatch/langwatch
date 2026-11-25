/**
 * @vitest-environment jsdom
 *
 * The devices tab as one inventory: every signed-in machine with the keys its
 * session minted beneath it, keys nothing accounts for under "Other keys".
 * @see specs/ai-gateway/governance/sessions-and-devices.feature
 */
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type SessionRow = {
  sessionStartedAtMs: number;
  deviceLabel: string;
  hostname: string | null;
  uname: string | null;
  platform: string | null;
  lastSeenMs: number;
  expiresAtMs: number;
  cliApiKeyId: string | null;
};

type KeyRow = {
  apiKeyId: string;
  name: string;
  sourceType: string;
  lookupId: string;
  ingestionTemplateId: string | null;
  deviceLabel: string | null;
  parentApiKeyId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number | null;
};

const state = vi.hoisted(() => ({
  sessions: [] as unknown[],
  keys: [] as unknown[],
  webSessions: [] as unknown[],
  sessionsFailed: false,
  keysFailed: false,
}));

const calls = vi.hoisted(() => ({
  revokeKey: vi.fn(),
  revokeDevice: vi.fn(),
  refetchedSessions: vi.fn(),
  refetchedKeys: vi.fn(),
  invalidatedSessions: vi.fn(),
  invalidatedKeys: vi.fn(),
}));

const handlers = vi.hoisted(() => ({
  onRevokeKeySuccess: null as null | ((result: unknown) => void),
  onRevokeDeviceSuccess: null as null | ((result: unknown) => void),
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const api = {
    useUtils: () => ({
      personalSessions: { list: { invalidate: calls.invalidatedSessions } },
      ingestionKey: { list: { invalidate: calls.invalidatedKeys } },
    }),
    personalSessions: {
      list: {
        useQuery: () => ({
          data: state.sessionsFailed ? void 0 : state.sessions,
          isLoading: false,
          isError: state.sessionsFailed,
          refetch: calls.refetchedSessions,
        }),
      },
      listWebSessions: {
        useQuery: () => ({ data: state.webSessions, isLoading: false, isError: false }),
      },
      revoke: {
        useMutation: (options: { onSuccess: (result: unknown) => void }) => {
          handlers.onRevokeDeviceSuccess = options.onSuccess;
          return { mutate: calls.revokeDevice, isPending: false };
        },
      },
      revokeAll: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    ingestionKey: {
      list: {
        useQuery: () => ({
          data: state.keysFailed ? void 0 : state.keys,
          isLoading: false,
          isError: state.keysFailed,
          refetch: calls.refetchedKeys,
        }),
      },
      revoke: {
        useMutation: (options: { onSuccess: (result: unknown) => void }) => {
          handlers.onRevokeKeySuccess = options.onSuccess;
          return { mutate: calls.revokeKey, isPending: false };
        },
      },
    },
  };
  return { personalWorkspaceApi: api, api };
});

vi.mock("../../../behavior/use-personal-context.ts", () => ({
  usePersonalContext: () => ({ organizationId: "org_1", ready: true }),
}));

import { DevicesPanel } from "../devices-panel.tsx";

function laptopSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionStartedAtMs: 1_000,
    deviceLabel: "MacBook Pro",
    hostname: "macbook-pro",
    uname: "jane",
    platform: "darwin",
    lastSeenMs: Date.now() - HOUR_MS,
    expiresAtMs: Date.now() + 30 * DAY_MS,
    cliApiKeyId: "key_login_laptop",
    ...overrides,
  };
}

function ingestionKey(overrides: Partial<KeyRow> = {}): KeyRow {
  return {
    apiKeyId: "key_ingest_claude",
    name: "claude_code",
    sourceType: "claude_code",
    lookupId: "lookup_1",
    ingestionTemplateId: null,
    deviceLabel: "MacBook Pro",
    parentApiKeyId: "key_login_laptop",
    createdAtMs: Date.now() - 5 * DAY_MS,
    lastUsedAtMs: Date.now() - 2 * HOUR_MS,
    ...overrides,
  };
}

function renderPanel() {
  const host = fakePersonalWorkspaceHost();
  renderWithPersonalWorkspaceHost(<DevicesPanel />, { host });
  return host;
}

function card(title: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-credential-card="${title}"]`);
  if (!element) throw new Error(`no card titled "${title}"`);
  return element;
}

describe("DevicesPanel", () => {
  beforeEach(() => {
    state.sessions = [];
    state.keys = [];
    state.webSessions = [];
    state.sessionsFailed = false;
    state.keysFailed = false;
    for (const call of Object.values(calls)) call.mockClear();
  });

  afterEach(cleanup);

  describe("given a browser sign-in and a CLI device", () => {
    /** @scenario "User sees ALL credential classes in one list on the devices tab" */
    it("lists the browser sign-in, marked as this device, above the device card", () => {
      state.webSessions = [
        {
          sessionId: "s1",
          identifierId: null,
          method: "Email and password",
          secondFactorProven: false,
          ipAddress: null,
          userAgent: null,
          signedInAt: "2026-09-27T00:00:00.000Z",
          lastActiveAt: "2026-09-27T00:00:00.000Z",
          expiresAt: "2026-10-27T00:00:00.000Z",
          current: true,
        },
      ];
      state.sessions = [laptopSession()];

      renderPanel();

      expect(screen.getByText("Browser sign-ins")).toBeTruthy();
      expect(screen.getByText("This device")).toBeTruthy();
      expect(card("MacBook Pro")).toBeTruthy();
    });
  });

  describe("given a session that minted a key and a key with no session behind it", () => {
    /** @scenario "Ingestion keys appear on the devices tab alongside CLI sessions" */
    it("puts the session's key on its card and the other one under Other keys", () => {
      state.sessions = [laptopSession()];
      state.keys = [
        ingestionKey(),
        ingestionKey({
          apiKeyId: "key_ingest_cursor",
          sourceType: "cursor",
          deviceLabel: null,
          parentApiKeyId: null,
          lastUsedAtMs: null,
        }),
      ];

      renderPanel();

      expect(within(card("MacBook Pro")).getByText("Ingestion key · claude_code")).toBeTruthy();
      expect(within(card("Other keys")).getByText("Ingestion key · cursor")).toBeTruthy();
    });

    /** @scenario "Ingestion key card shows last used" */
    it("says when each key was last used and first issued", () => {
      state.sessions = [laptopSession()];
      state.keys = [
        ingestionKey(),
        ingestionKey({ apiKeyId: "key_cursor", sourceType: "cursor", lastUsedAtMs: null }),
      ];

      renderPanel();

      const rowText = (source: string) =>
        document.querySelector(`[data-ingestion-key="${source}"]`)?.textContent ?? "";
      expect(rowText("claude_code")).toMatch(/Last used 2h ago · First issued \w+/);
      expect(rowText("cursor")).toMatch(/Last used Never · First issued \w+/);
    });
  });

  describe("when the reader revokes one ingestion key", () => {
    /** @scenario "User revokes a single ingestion key card" */
    it("asks twice, revokes that key alone, and reads both lists again", async () => {
      state.sessions = [laptopSession()];
      state.keys = [
        ingestionKey(),
        ingestionKey({ apiKeyId: "key_ingest_codex", sourceType: "codex" }),
      ];
      const user = userEvent.setup();
      renderPanel();

      await user.click(
        screen.getByRole("button", { name: "Revoke the claude_code ingestion key on MacBook Pro" }),
      );
      expect(calls.revokeKey).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Confirm revoke" }));

      expect(calls.revokeKey).toHaveBeenCalledWith({
        organizationId: "org_1",
        apiKeyId: "key_ingest_claude",
      });
      handlers.onRevokeKeySuccess?.({ success: true });
      expect(calls.invalidatedSessions).toHaveBeenCalledWith({ organizationId: "org_1" });
      expect(calls.invalidatedKeys).toHaveBeenCalledWith({ organizationId: "org_1" });
    });
  });

  describe("when the reader revokes the device itself", () => {
    it("says the machine's ingestion keys stop with it", async () => {
      state.sessions = [laptopSession()];
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Revoke" }));

      expect(screen.getByText(/the ingestion keys it minted stop with it/)).toBeTruthy();
    });

    it("counts the tokens and the keys the server retired", () => {
      state.sessions = [laptopSession()];
      const host = renderPanel();

      handlers.onRevokeDeviceSuccess?.({ ok: true, revokedTokens: 2, revokedKeys: 3 });

      expect(host.recording.successes[0]?.description).toContain("2 tokens and 3 keys");
    });
  });

  describe("given nothing signed in and no keys", () => {
    it("offers the way to sign a device in", () => {
      renderPanel();

      expect(screen.getByText("No devices signed in")).toBeTruthy();
    });
  });

  describe("given a key list that failed to load", () => {
    it("says so rather than claiming nothing is signed in, and retries both", async () => {
      state.keysFailed = true;
      renderPanel();

      expect(screen.queryByText("No devices signed in")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(calls.refetchedSessions).toHaveBeenCalledTimes(1);
      expect(calls.refetchedKeys).toHaveBeenCalledTimes(1);
    });
  });

  describe("given only a key and no session", () => {
    it("shows the key under Other keys, falling back to the key id for its name", () => {
      state.keys = [
        ingestionKey({ apiKeyId: "ak_no_label_aaaaaa", parentApiKeyId: null, deviceLabel: null }),
      ];

      renderPanel();

      expect(screen.getByText("Other keys")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Revoke the claude_code ingestion key on key aaaaaa" }),
      ).toBeTruthy();
    });
  });
});
