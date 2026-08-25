/**
 * @vitest-environment jsdom
 *
 * Analytics instrumentation on the coding-agent onboarding screen.
 *
 * The screen renders install commands and an MCP config that EMBED the
 * project API key, so the property allowlist is a privacy property, not a
 * tidiness one: every payload must stay a fixed identifier and must never
 * carry the copied string.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
const clipboardWriteMock = vi.fn<(text: string) => Promise<void>>();

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

const API_KEY = "sk-lw-test-SUPERSECRET-000";

vi.mock("../../contexts/ActiveProjectContext", () => ({
  useActiveProject: () => ({
    project: { id: "project-1", apiKey: API_KEY },
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { BASE_HOST: "https://app.langwatch.ai" } }),
}));

vi.mock("../../../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import { ViaClaudeCodeScreen } from "./ViaClaudeCodeScreen";

type EmitCall = [string, string, Record<string, unknown> | undefined];

function emitted(): EmitCall[] {
  return emitMock.mock.calls as EmitCall[];
}

/**
 * The emit calls padded so destructuring a missing call yields undefined
 * rather than throwing, letting each test assert the count itself.
 */
function onlyEmit(): EmitCall {
  return emitted()[0] ?? ["", "", undefined];
}

function renderScreen() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ViaClaudeCodeScreen />
    </ChakraProvider>,
  );
}

/** An element on each tab, used to wait out the AnimatePresence swap. */
const TAB_MARKER: Record<string, RegExp> = {
  Prompt: /^Copy prompt$/,
  Skill: /^Copy install command:/,
  MCP: /^Copy config$/,
};

function copyButtons(): HTMLElement[] {
  return screen
    .queryAllByRole("button")
    .filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Copy "));
}

function findCopyButton(pattern: RegExp): HTMLElement | undefined {
  return copyButtons().find((b) => pattern.test(b.getAttribute("aria-label") ?? ""));
}

/**
 * Switches tab and waits for its content to mount. The tab panels live in an
 * `AnimatePresence mode="wait"`, so the incoming panel only mounts once the
 * outgoing one has finished exiting; querying straight after the click finds
 * the previous tab. Clears the `selected` event the switch itself emits.
 */
async function goToTab(name: keyof typeof TAB_MARKER | string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name }));
  const marker = TAB_MARKER[name];
  if (marker) {
    // Generous timeout: the swap is a real animation frame chain, and it
    // runs well past the 1s default when the whole file executes together.
    await waitFor(() => expect(findCopyButton(marker)).toBeDefined(), {
      timeout: 10_000,
    });
  }
  emitMock.mockClear();
}

/**
 * Clicks every copyable control on every tab and returns everything emitted.
 * The MCP tab is the point of the sweep: its quick commands and config JSON
 * embed the raw API key.
 */
async function copyEverythingOnEveryTab(): Promise<EmitCall[]> {
  const collected: EmitCall[] = [];
  for (const tab of ["Prompt", "Skill", "MCP"]) {
    await goToTab(tab);
    for (const button of copyButtons()) fireEvent.click(button);
    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    collected.push(...emitted());
  }
  return collected;
}

beforeEach(() => {
  emitMock.mockClear();
  clipboardWriteMock.mockReset();
  clipboardWriteMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWriteMock },
    configurable: true,
    writable: true,
  });
});

afterEach(cleanup);

describe("when the user copies a skill prompt", () => {
  /** @scenario Copying a prompt reports the skill it came from */
  it("emits copied/prompt carrying only the skill id", async () => {
    renderScreen();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy prompt" })[0]!);

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("prompt");
    expect(Object.keys(properties ?? {})).toEqual(["skill"]);
    expect(typeof properties?.skill).toBe("string");
  });
});

describe("when the user copies a skill slash command", () => {
  /** @scenario Copying a slash command reports the skill it came from */
  it("emits copied/slash_command carrying only the skill id", async () => {
    renderScreen();
    await goToTab("Skill");

    const slashButton = findCopyButton(/^Copy \//);
    expect(slashButton).toBeDefined();
    fireEvent.click(slashButton!);

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("slash_command");
    expect(Object.keys(properties ?? {})).toEqual(["skill"]);
  });
});

describe("when the user copies a skill install command", () => {
  /** @scenario Copying a skill install command reports the skill it came from */
  it("emits copied/install_command carrying only the skill id", async () => {
    renderScreen();
    await goToTab("Skill");

    const installButton = findCopyButton(/^Copy install command:/);
    expect(installButton).toBeDefined();
    fireEvent.click(installButton!);

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("install_command");
    expect(Object.keys(properties ?? {})).toEqual(["skill"]);
  });
});

describe("when the user copies an agent quick command on the MCP tab", () => {
  /** @scenario Copying an agent quick command reports the agent it configures */
  it("emits copied/install_command carrying only the agent id", async () => {
    renderScreen();
    await goToTab("MCP");

    fireEvent.click(screen.getAllByRole("button", { name: "Copy command" })[0]!);

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("install_command");
    expect(properties).toEqual({ agent: "claude-code" });
  });

  it("reports codex for the second quick command", async () => {
    renderScreen();
    await goToTab("MCP");

    fireEvent.click(screen.getAllByRole("button", { name: "Copy command" })[1]!);

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    expect(onlyEmit()[2]).toEqual({ agent: "codex" });
  });
});

describe("when the user copies the MCP config", () => {
  /** @scenario Copying the MCP config reports no further detail */
  it("emits copied/mcp_config with no properties", async () => {
    renderScreen();
    await goToTab("MCP");

    fireEvent.click(screen.getByRole("button", { name: "Copy config" }));

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("mcp_config");
    expect(properties).toBeUndefined();
  });
});

describe("when the user copies an editor config path", () => {
  /** @scenario Copying an editor config path reports the editor */
  it("emits copied/config_path carrying only the editor name", async () => {
    renderScreen();
    await goToTab("MCP");

    fireEvent.click(screen.getByRole("button", { name: "Copy Cursor config path" }));

    await waitFor(() => expect(emitMock).toHaveBeenCalled());
    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("copied");
    expect(object).toBe("config_path");
    expect(properties).toEqual({ editor: "Cursor" });
  });
});

describe("when the user switches tabs", () => {
  /** @scenario Switching tabs reports the tab selected */
  it("emits selected/tab carrying only the tab key", () => {
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Skill" }));

    expect(emitted()).toHaveLength(1);
    const [action, object, properties] = onlyEmit();
    expect(action).toBe("selected");
    expect(object).toBe("tab");
    expect(properties).toEqual({ tab: "skill" });
  });
});

describe("when the clipboard write fails", () => {
  /** @scenario A failed copy emits no analytics event */
  it("emits no analytics event", async () => {
    clipboardWriteMock.mockRejectedValue(new Error("denied"));
    renderScreen();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy prompt" })[0]!);

    await waitFor(() => expect(clipboardWriteMock).toHaveBeenCalled());
    expect(emitMock).not.toHaveBeenCalled();
  });
});

describe("given the screen renders commands that embed the project API key", () => {
  /** @scenario No onboarding analytics payload carries the project API key */
  it("never puts the API key or the copied text in an analytics payload", async () => {
    renderScreen();
    const emittedAcrossTabs = await copyEverythingOnEveryTab();

    // The copy paths really did handle the secret, so the assertions below
    // are about the analytics payloads and not about an inert fixture.
    const copiedTexts = clipboardWriteMock.mock.calls.map(([text]) => text);
    expect(copiedTexts.some((text) => text.includes(API_KEY))).toBe(true);
    expect(emittedAcrossTabs.length).toBeGreaterThan(0);

    const payloads = emittedAcrossTabs.map(([, , properties]) =>
      JSON.stringify(properties ?? {}),
    );
    expect(payloads.filter((p) => p.includes(API_KEY))).toEqual([]);
    expect(payloads.filter((p) => copiedTexts.some((t) => p.includes(t)))).toEqual([]);
  });
});
