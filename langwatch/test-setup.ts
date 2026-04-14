import "@testing-library/jest-dom/vitest";
import dotenv from "dotenv";
import { vi } from "vitest";
import { TEST_PUBLIC_KEY } from "./ee/licensing/__tests__/fixtures/testKeys";
dotenv.config({ path: ".env" });

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
// Must support forwardRef for Chakra's `asChild` pattern.
vi.mock("~/utils/compat/next-link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { children, href, as: _as, replace: _replace, scroll: _scroll, shallow: _shallow, passHref: _passHref, prefetch: _prefetch, locale: _locale, legacyBehavior: _legacyBehavior, ...props }: any,
      ref: any
    ) {
      return React.createElement("a", { ref, href: typeof href === "string" ? href : href?.pathname ?? "/", ...props }, children);
    }),
  };
});

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockLink(
      { children, href, ...props }: any,
      ref: any
    ) {
      return React.createElement("a", { ref, href: typeof href === "string" ? href : href?.pathname ?? "/", ...props }, children);
    }),
  };
});

// Mock ResizeObserver for tests using floating-ui/popper (Chakra menus, tooltips, etc.)
globalThis.ResizeObserver = class ResizeObserver {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op for test mock
  disconnect() {}
};
