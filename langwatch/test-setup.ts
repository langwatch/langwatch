import os from "node:os";
import path from "node:path";
import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";
import { afterAll, vi } from "vitest";
import { TEST_PUBLIC_KEY } from "./ee/licensing/__tests__/fixtures/testKeys";

dotenv.config({ path: ".env" });

// Born-on-storage (ADR-032): every dataset create writes chunk objects to the
// resolved storage backend. Tests run without S3, so the resolver falls back to
// the local FS — and its default root (`/var/lib/langwatch/objects`) isn't
// writable in CI, which would 500 every dataset create. Point it at a writable
// temp dir before `~/env.mjs` reads it (this file is a setupFile, so it runs
// before the test module's import graph). An explicit path from `.env` (local
// dev) is honored via `??=`.
process.env.LANGWATCH_LOCAL_STORAGE_PATH ??= path.join(
  os.tmpdir(),
  "langwatch-test-storage",
);

// Any test that evaluates a PostHog-backed PRODUCT flag (e.g. resolveHome ->
// featureFlagService.isEnabled) constructs the posthog-node client, whose
// local-evaluation poller is a setInterval that posthog-node does not unref.
// That timer keeps the worker's event loop alive, so under --coverage (where
// vitest awaits a graceful worker exit instead of force-killing the pool) the
// shard hangs after every test has already passed. Shutting the client down
// per file clears the interval; it no-ops when nothing constructed a client.
//
// The module is loaded lazily inside the hook, NOT via a top-level import: a
// static import here would pull the real posthog module into every test
// file's graph at setup time, before that file's own `vi.mock("posthog-node")`
// hoist applies, breaking posthog.unit.test.ts. Loading it after the tests run
// keeps each file's mocks intact.
//
// The flush is wrapped because posthog-node's shutdown clears the local-eval
// poller (the hang fix) FIRST, then does a final network flush that builds a
// `new URL(...)`. In a jsdom suite this hook runs as the env globals are being
// torn down, so `URL` may already be gone and the flush throws — by which
// point the interval is already cleared, so the error is safe to ignore.
afterAll(async () => {
  try {
    const { shutdownPostHog } = await import("./src/server/posthog");
    await shutdownPostHog();
  } catch {
    // Teardown-phase flush can throw once test env globals (URL/fetch) are
    // gone; the poller is already cleared by then, so swallow it.
  }

  // Diagnostic: dump active event-loop handles AFTER the normal afterAll chain
  // has run. Anything still here is what's keeping the fork from exiting and
  // ultimately wedging the shard. The CI artifact stays small but surfaces
  // the actual remote endpoint for each socket so the leaking connection can
  // be identified by name (clickhouse host, redis host, postgres host, ...).
  // Opt-out via DEBUG_OPEN_HANDLES=0 if needed.
  if (process.env.DEBUG_OPEN_HANDLES !== "0") {
    try {
      // @ts-expect-error -- internal API, intentional
      const handles = process._getActiveHandles?.() ?? [];
      // @ts-expect-error -- internal API, intentional
      const requests = process._getActiveRequests?.() ?? [];
      if (handles.length > 0 || requests.length > 0) {
        const describeSocket = (s: any): string => {
          try {
            const remote =
              s.remoteAddress && s.remotePort
                ? `${s.remoteAddress}:${s.remotePort}`
                : undefined;
            const local =
              s.localAddress && s.localPort
                ? `${s.localAddress}:${s.localPort}`
                : undefined;
            const fd = typeof s.fd === "number" ? s.fd : undefined;
            const meta = [
              remote ? `r=${remote}` : null,
              local ? `l=${local}` : null,
              fd != null ? `fd=${fd}` : null,
            ]
              .filter(Boolean)
              .join(",");
            return meta || "?";
          } catch {
            return "?";
          }
        };
        const socketDetails: string[] = [];
        const otherCounts: Record<string, number> = {};
        for (const h of handles) {
          const k = h?.constructor?.name ?? typeof h;
          if (k === "Socket" || k === "TLSSocket") {
            socketDetails.push(`${k}(${describeSocket(h)})`);
          } else {
            otherCounts[k] = (otherCounts[k] ?? 0) + 1;
          }
        }
        const requestCounts: Record<string, number> = {};
        for (const r of requests) {
          const k = r?.constructor?.name ?? typeof r;
          requestCounts[k] = (requestCounts[k] ?? 0) + 1;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[open-handles] handles=${handles.length} requests=${requests.length} | sockets=${JSON.stringify(socketDetails)} other=${JSON.stringify(otherCounts)} requests=${JSON.stringify(requestCounts)}`,
        );
      }
    } catch {
      // ignore
    }
  }
});

// Mock recharts to avoid ESM/CJS compatibility issues with @reduxjs/toolkit in vmThreads pool.
// Tests don't need actual chart rendering - we're testing our logic, not recharts itself.
vi.mock("recharts", () => {
  const MockComponent = ({ children }: { children?: React.ReactNode }) =>
    children ?? null;
  return {
    ResponsiveContainer: MockComponent,
    LineChart: MockComponent,
    Line: MockComponent,
    BarChart: MockComponent,
    Bar: MockComponent,
    XAxis: MockComponent,
    YAxis: MockComponent,
    CartesianGrid: MockComponent,
    Tooltip: MockComponent,
    Legend: MockComponent,
    Area: MockComponent,
    AreaChart: MockComponent,
    PieChart: MockComponent,
    Pie: MockComponent,
    Cell: MockComponent,
    ComposedChart: MockComponent,
    ReferenceLine: MockComponent,
    ReferenceArea: MockComponent,
    Brush: MockComponent,
    Scatter: MockComponent,
    ScatterChart: MockComponent,
    RadarChart: MockComponent,
    Radar: MockComponent,
    PolarGrid: MockComponent,
    PolarAngleAxis: MockComponent,
    PolarRadiusAxis: MockComponent,
    Treemap: MockComponent,
    Funnel: MockComponent,
    FunnelChart: MockComponent,
    Sankey: MockComponent,
  };
});

// Set TEST_PUBLIC_KEY for license verification in integration tests.
// This allows test licenses (signed with TEST_PRIVATE_KEY) to validate correctly.
process.env.LANGWATCH_LICENSE_PUBLIC_KEY = TEST_PUBLIC_KEY;

// Mock @copilotkit/react-ui to avoid @react-aria/interactions crash in vmThreads.
// React-aria's useFocusVisible.mjs has a top-level side effect that patches
// HTMLElement.prototype.focus, which fails in vmThreads external module context.
// No tests exercise CopilotKit features, so this mock is safe.
vi.mock("@copilotkit/react-ui", () => {
  const Noop = () => null;
  return {
    CopilotChat: Noop,
    AssistantMessage: Noop,
    UserMessage: Noop,
  };
});

// Mock the router compat layer for tests.
// Components import useRouter from ~/utils/compat/next-router which
// calls React Router hooks (useNavigate, useLocation, etc.) that require
// <BrowserRouter> context. In tests, we provide a stub.
const mockRouter = {
  query: {},
  pathname: "/",
  asPath: "/",
  isReady: true,
  route: "/",
  basePath: "",
  locale: undefined,
  locales: undefined,
  defaultLocale: undefined,
  isFallback: false,
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  push: vi.fn().mockResolvedValue(true),
  replace: vi.fn().mockResolvedValue(true),
  back: vi.fn(),
  reload: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
  beforePopState: vi.fn(),
};

// To opt out of this global mock (e.g. when testing the compat layer itself
// against a real react-router MemoryRouter), see the vi.unmock pattern in
// src/components/suites/__tests__/RunsFilterUrlSync.integration.test.tsx.
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
  default: mockRouter,
  // Re-export the type aliases
  NextRouter: {},
}));

// Also mock the old next/router and next/navigation paths in case any test
// mocks reference them directly
vi.mock("next/router", () => ({
  useRouter: () => mockRouter,
  default: mockRouter,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Mock Link components that use React Router (requires Router context).
vi.mock("~/utils/compat/next-link", () => {
  const React = require("react");
  return {
    default: React.forwardRef(function MockLink(
      { children, href, ...props }: any,
      ref: any,
    ) {
      return React.createElement(
        "a",
        {
          ref,
          href: typeof href === "string" ? href : (href?.pathname ?? "/"),
          ...props,
        },
        children,
      );
    }),
  };
});

vi.mock("next/link", () => {
  const React = require("react");
  return {
    default: React.forwardRef(function MockLink(
      { children, href, ...props }: any,
      ref: any,
    ) {
      return React.createElement(
        "a",
        {
          ref,
          href: typeof href === "string" ? href : (href?.pathname ?? "/"),
          ...props,
        },
        children,
      );
    }),
  };
});

// Mock dynamic() (next-dynamic compat) to return a simple passthrough in tests.
// The real implementation uses React.lazy() which suspends in jsdom when
// dynamic imports don't resolve synchronously.
vi.mock("~/utils/compat/next-dynamic", () => ({
  default: (importFn: () => Promise<any>, options?: any) => {
    const React = require("react");
    const Loading = options?.loading ?? (() => null);
    // Return a component that just renders the loading fallback.
    // The actual dynamically-imported component doesn't matter for most tests.
    return function DynamicMock(props: any) {
      return React.createElement(Loading);
    };
  },
}));

// Polyfill window.matchMedia for Vitest/JSDOM (not implemented by default).
// Prevents "TypeError: window.matchMedia is not a function" when components
// or hooks call matchMedia at module or render time.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  // Match the real one-argument constructor signature so callers like
  // `new ResizeObserver(cb)` aren't flagged as passing a superfluous arg.
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  constructor(_callback?: ResizeObserverCallback) {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  disconnect() {}
};
