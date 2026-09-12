/**
 * @vitest-environment jsdom
 *
 * The devices tab as one inventory: every signed-in machine, and under each
 * of them the ingestion keys that machine's session minted. A key nothing on
 * the page accounts for still has to be visible, and every row has to be
 * revocable on its own.
 *
 * @see specs/ai-gateway/governance/sessions-and-devices.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  sourceType: string;
  deviceLabel: string | null;
  parentApiKeyId: string | null;
  createdAtMs: number;
  lastUsedAtMs: number | null;
};

const state = vi.hoisted(() => ({
  sessions: [] as unknown[],
  keys: [] as unknown[],
  isReady: true,
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
  toasts: [] as { title?: string; description?: string }[],
}));

/**
 * The mutations' `onSuccess`, kept so a test can land the answer the server
 * would have given and then read what the panel did with it.
 */
const handlers = vi.hoisted(() => ({
  onRevokeKeySuccess: null as null | ((result: unknown) => void),
  onRevokeDeviceSuccess: null as null | ((result: unknown) => void),
}));

vi.mock("~/utils/api", () => ({
  api: {
    // The empty state offers the CLI install card, which reads the public
    // environment for the endpoint it prints.
    publicEnv: { useQuery: () => ({ data: void 0 }) },
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
      revoke: {
        useMutation: (options: { onSuccess: (result: unknown) => void }) => {
          handlers.onRevokeDeviceSuccess = options.onSuccess;
          return { mutate: calls.revokeDevice, isPending: false };
        },
      },
      revokeAll: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
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
  },
}));

vi.mock("../usePersonalContext", () => ({
  usePersonalContext: () => ({ organizationId: "org_1", ready: state.isReady }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (toast: { title?: string; description?: string }) => {
      calls.toasts.push(toast);
    },
  },
}));

vi.mock("~/features/errors", () => ({ showErrorToast: vi.fn() }));

import { DevicesPanel } from "../DevicesPanel";

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
    sourceType: "claude_code",
    deviceLabel: "MacBook Pro",
    parentApiKeyId: "key_login_laptop",
    createdAtMs: Date.now() - 5 * DAY_MS,
    lastUsedAtMs: Date.now() - 2 * HOUR_MS,
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DevicesPanel />
    </ChakraProvider>,
  );
}

/** The card whose heading is `title`, as the reader sees it. */
function card(title: string): HTMLElement {
  const element = document.querySelector(`[data-credential-card="${title}"]`);
  if (!element) throw new Error(`no card titled "${title}"`);
  return element as HTMLElement;
}

/** The row of one source's ingestion key, wherever it landed. */
function keyRow(sourceType: string): HTMLElement {
  const element = document.querySelector(
    `[data-ingestion-key="${sourceType}"]`,
  );
  if (!element) throw new Error(`no key row for "${sourceType}"`);
  return element as HTMLElement;
}

describe("DevicesPanel", () => {
  beforeEach(() => {
    state.sessions = [];
    state.keys = [];
    state.isReady = true;
    state.sessionsFailed = false;
    state.keysFailed = false;
    calls.revokeKey.mockClear();
    calls.revokeDevice.mockClear();
    calls.refetchedSessions.mockClear();
    calls.refetchedKeys.mockClear();
    calls.invalidatedSessions.mockClear();
    calls.invalidatedKeys.mockClear();
    calls.toasts.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a session that minted a key and a key with no session behind it", () => {
    beforeEach(() => {
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
    });

    /** @scenario "Ingestion keys appear on the devices tab alongside CLI sessions" */
    it("puts the session's key on its card and the other one under Other keys", () => {
      renderPanel();

      expect(
        within(card("MacBook Pro")).getByText("Ingestion key · claude_code"),
      ).toBeInTheDocument();
      expect(
        within(card("Other keys")).getByText("Ingestion key · cursor"),
      ).toBeInTheDocument();
      expect(
        within(card("MacBook Pro")).queryByText("Ingestion key · cursor"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "Ingestion key card shows last used" */
    it("reads each key's last use and the date it was first issued", () => {
      renderPanel();

      expect(keyRow("claude_code").textContent).toContain("Last used 2h ago");
      expect(keyRow("claude_code").textContent).toContain("First issued");
      expect(keyRow("cursor").textContent).toContain("Last used Never");
    });
  });

  describe("when the reader revokes one key row", () => {
    beforeEach(() => {
      state.sessions = [laptopSession()];
      state.keys = [
        ingestionKey(),
        ingestionKey({
          apiKeyId: "key_ingest_codex",
          sourceType: "codex",
        }),
      ];
    });

    /** @scenario "User revokes a single ingestion key card" */
    it("asks twice, revokes that key alone, and reads both lists again", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(
        screen.getByRole("button", {
          name: "Revoke the claude_code ingestion key on MacBook Pro",
        }),
      );
      expect(calls.revokeKey).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          /Revoke this ingestion key\? Anything exporting claude_code traces/,
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Confirm revoke" }));

      expect(calls.revokeKey).toHaveBeenCalledWith({
        organizationId: "org_1",
        apiKeyId: "key_ingest_claude",
      });
      expect(screen.getByText("Ingestion key · codex")).toBeInTheDocument();

      handlers.onRevokeKeySuccess?.({ success: true });
      expect(calls.invalidatedSessions).toHaveBeenCalledWith({
        organizationId: "org_1",
      });
      expect(calls.invalidatedKeys).toHaveBeenCalledWith({
        organizationId: "org_1",
      });
    });
  });

  describe("when the reader revokes the device itself", () => {
    beforeEach(() => {
      state.sessions = [laptopSession()];
      state.keys = [ingestionKey()];
    });

    it("says the machine's ingestion keys stop with it", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole("button", { name: "Revoke" }));

      expect(
        screen.getByText(/the ingestion keys it minted stop with it/),
      ).toBeInTheDocument();
    });

    it("counts the tokens and the keys the server retired in the toast", () => {
      renderPanel();

      handlers.onRevokeDeviceSuccess?.({
        ok: true,
        revokedTokens: 2,
        revokedKeys: 3,
      });

      expect(calls.toasts[0]?.description).toContain("2 tokens and 3 keys");
    });
  });

  describe("given nothing signed in and no keys", () => {
    it("offers the way to sign a device in", () => {
      renderPanel();

      expect(screen.getByText("No devices signed in")).toBeInTheDocument();
    });
  });

  describe("given a key list that failed to load", () => {
    it("says so rather than claiming nothing is signed in", async () => {
      state.keysFailed = true;

      renderPanel();

      expect(
        screen.queryByText("No devices signed in"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("Could not load your devices and keys"),
      ).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(calls.refetchedSessions).toHaveBeenCalledTimes(1);
      expect(calls.refetchedKeys).toHaveBeenCalledTimes(1);
    });

    it("says the same when it is the session list that failed", () => {
      state.sessionsFailed = true;

      renderPanel();

      expect(
        screen.getByText("Could not load your devices and keys"),
      ).toBeInTheDocument();
    });
  });

  describe("given two keys for the same source on different machines", () => {
    it("names each revoke button after the machine that holds the key", () => {
      state.keys = [
        ingestionKey({
          apiKeyId: "ak_laptop",
          parentApiKeyId: null,
          deviceLabel: "MacBook Pro",
        }),
        ingestionKey({
          apiKeyId: "ak_buildbox",
          parentApiKeyId: null,
          deviceLabel: "build-box",
        }),
      ];

      renderPanel();

      expect(
        screen.getByRole("button", {
          name: "Revoke the claude_code ingestion key on MacBook Pro",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: "Revoke the claude_code ingestion key on build-box",
        }),
      ).toBeInTheDocument();
    });

    it("falls back to the key's own id when neither carries a machine label", () => {
      state.keys = [
        ingestionKey({
          apiKeyId: "ak_no_label_aaaaaa",
          parentApiKeyId: null,
          deviceLabel: null,
        }),
      ];

      renderPanel();

      expect(
        screen.getByRole("button", {
          name: "Revoke the claude_code ingestion key on key aaaaaa",
        }),
      ).toBeInTheDocument();
    });
  });

  describe("given only a key and no session", () => {
    it("shows the key rather than claiming nothing is signed in", () => {
      state.keys = [ingestionKey({ parentApiKeyId: null })];

      renderPanel();

      expect(
        screen.queryByText("No devices signed in"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Other keys")).toBeInTheDocument();
    });
  });
});
