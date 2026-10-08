// @vitest-environment jsdom
/**
 * Spec: specs/ui/module-host-mounting.feature, specs/navigation/chunk-load-retry.feature
 */
import { isChunkLoadFailure } from "@langwatch/browser-host/navigation";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, render, screen } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A retry asks for the chunk by address; here every address stays dropped.
vi.mock("../../../browser-host/src/chunk-refetch.ts", () => ({
  importChunkAgain: async () => {
    throw new TypeError("Failed to fetch dynamically imported module: http://localhost/x.js");
  },
}));

import { createUiModuleHostStack } from "../ui-module-hosts.tsx";
import { UiChunkLoadFailure } from "../ui-page-fallbacks.tsx";

const ProbeHost = createContext<string | null>(null);

function probeMount(answer: string) {
  return async () => ({
    default: ({ children }: { children?: ReactNode }) => (
      <ProbeHost.Provider value={answer}>{children}</ProbeHost.Provider>
    ),
  });
}

/** Stands in for a screen: it reads the port and says so, or says it is bare. */
function ProbeScreen() {
  return <span>{useContext(ProbeHost) ?? "no host"}</span>;
}

describe("createUiModuleHostStack", () => {
  describe("given a module that mounts a host and a screen that reads it", () => {
    /** @scenario "A module's host is mounted above the page that reads it" */
    it("renders the host above the routed children", async () => {
      const Hosts = createUiModuleHostStack([
        { module: "secret", host: "SecretHostApi", load: probeMount("secret's host") },
      ]);

      render(
        <Hosts>
          <ProbeScreen />
        </Hosts>,
      );

      expect(await screen.findByText("secret's host")).toBeTruthy();
    });
  });

  describe("given a module that mounts a host read by a peer's screen", () => {
    /** @scenario "A module's host is mounted above a peer's page too" */
    it("renders it above everything routed, not only its own module's screens", async () => {
      const Hosts = createUiModuleHostStack([
        { module: "workflow", host: "WorkflowHostApi", load: probeMount("workflow's host") },
      ]);

      // The child here belongs to scenario, not workflow: the stack knows
      // nothing about which module a rendered page came from, which is the point.
      render(
        <Hosts>
          <ProbeScreen />
        </Hosts>,
      );

      expect(await screen.findByText("workflow's host")).toBeTruthy();
    });
  });

  describe("given several mounts", () => {
    it("renders them in install order, outermost first", async () => {
      const Hosts = createUiModuleHostStack([
        { module: "outer", host: "OuterHostApi", load: probeMount("outer") },
        { module: "inner", host: "InnerHostApi", load: probeMount("inner") },
      ]);

      render(
        <Hosts>
          <ProbeScreen />
        </Hosts>,
      );

      // The innermost provider is the one a screen reads.
      expect(await screen.findByText("inner")).toBeTruthy();
    });
  });

  describe("given no mounts at all", () => {
    it("draws its children unframed rather than refusing", () => {
      const Hosts = createUiModuleHostStack([]);

      render(
        <Hosts>
          <ProbeScreen />
        </Hosts>,
      );

      expect(screen.getByText("no host")).toBeTruthy();
    });
  });
});

describe("given a mount that resolves to no component", () => {
  /** @scenario "A mount with nothing to render is refused by name" */
  it("refuses naming the module and the host", async () => {
    const Hosts = createUiModuleHostStack([
      { module: "secret", host: "SecretHostApi", load: async () => ({}) },
    ]);
    const thrown: unknown[] = [];

    render(
      <ErrorBoundary
        FallbackComponent={({ error }) => {
          thrown.push(error);
          return <span>refused</span>;
        }}
      >
        <Hosts>
          <ProbeScreen />
        </Hosts>
      </ErrorBoundary>,
    );

    expect(await screen.findByText("refused")).toBeTruthy();
    expect(String(thrown[0])).toContain("secret");
    expect(String(thrown[0])).toContain("SecretHostApi");
  });
});

describe("given a mount whose module will not load", () => {
  // The chunk is retried with backoff before the stack gives up; run those waits now.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const giveUpRetrying = () => act(() => vi.advanceTimersByTimeAsync(5_000));

  /** @scenario "A mount with nothing to render is refused by name" */
  it("names the module and host rather than only the chunk url", async () => {
    const Hosts = createUiModuleHostStack([
      {
        module: "licensing",
        host: "LicensingHostApi",
        load: async () => {
          throw new TypeError("Failed to fetch dynamically imported module: /@fs/x.tsx");
        },
      },
    ]);
    const thrown: unknown[] = [];

    render(
      <ErrorBoundary
        FallbackComponent={({ error }) => {
          thrown.push(error);
          return <span>refused</span>;
        }}
      >
        <Hosts>
          <ProbeScreen />
        </Hosts>
      </ErrorBoundary>,
    );

    await giveUpRetrying();
    expect(await screen.findByText("refused")).toBeTruthy();
    expect(String(thrown[0])).toContain("licensing");
    expect(String(thrown[0])).toContain("LicensingHostApi");
    expect((thrown[0] as Error).cause).toBeInstanceOf(TypeError);
  });

  /** @scenario "A failure that outlives its retries offers a retry" */
  it("shows the root's check-your-connection screen, not a blank page", async () => {
    const Hosts = createUiModuleHostStack([
      {
        module: "authz",
        host: "AuthzHostApi",
        load: async () => {
          throw new TypeError("Failed to fetch dynamically imported module: http://localhost/x.js");
        },
      },
    ]);

    render(
      <DesignSystemProvider forcedTheme="light">
        <ErrorBoundary
          FallbackComponent={({ error }) =>
            isChunkLoadFailure(error) ? <UiChunkLoadFailure /> : <span>other failure</span>
          }
        >
          <Hosts>
            <ProbeScreen />
          </Hosts>
        </ErrorBoundary>
      </DesignSystemProvider>,
    );

    await giveUpRetrying();
    expect(await screen.findByText("Could not load")).toBeTruthy();
    expect(screen.getByText("Check your connection, then try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
