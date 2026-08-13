/**
 * @vitest-environment jsdom
 *
 * Both gates on the Custom query surface, and both are server answers: the
 * permission guard, and the deployment's provisioning. Neither can be turned on
 * from the browser, which is the point of the first scenario below.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { explainHandledError, readHandledError } from "~/features/errors";

import { CustomQueryMenuLink } from "../components/CustomQueryMenuLink";
import {
  governedSqlNotEnabledPayload,
  governedSqlUnavailablePayload,
} from "../logic/governedSqlFailure";

import { SCHEMA_RESPONSE } from "./governedSqlFixtures";

const harness = vi.hoisted(() => ({
  available: true,
  reason: undefined as "disabled" | "unprovisioned" | undefined,
  hasPermission: true,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ client: {} }),
    analytics: {
      governedSql: {
        availability: {
          useQuery: () => ({
            data: { available: harness.available, reason: harness.reason },
            isLoading: false,
            error: null,
          }),
        },
        schema: {
          useQuery: () => ({
            data: SCHEMA_RESPONSE,
            isLoading: false,
            error: null,
          }),
        },
      },
      savedWorkbenchCharts: {
        getAll: {
          useQuery: () => ({ data: [], isLoading: false, error: null }),
        },
        create: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        update: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
        delete: {
          useMutation: () => ({
            mutateAsync: async () => ({}),
            isPending: false,
          }),
        },
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "my-project" },
    isLoading: false,
    hasAnyPermission: () => harness.hasPermission,
    hasPermission: () => harness.hasPermission,
  }),
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

vi.mock("~/utils/compat/next-link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => "/my-project/analytics",
}));

// Monaco reaches the editor through the code-splitting shim, whose lazy
// boundary never resolves under jsdom. Standing a textarea in for the shim's
// result means the page under assertion is the mounted one rather than one
// held permanently on a loading fallback.
vi.mock("~/utils/compat/next-dynamic", () => {
  function StubMonacoEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="stub-monaco"
        aria-label="Governed ClickHouse SQL"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: () => StubMonacoEditor };
});

import GuardedCustomQueryPage from "~/pages/[project]/analytics/query";

function renderPage() {
  render(
    <ChakraProvider value={defaultSystem}>
      <GuardedCustomQueryPage />
    </ChakraProvider>,
  );
}

function renderMenuLink() {
  render(
    <ChakraProvider value={defaultSystem}>
      <CustomQueryMenuLink projectId="project-1" projectSlug="my-project" />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.available = true;
  harness.reason = undefined;
  harness.hasPermission = true;
});

/** The words the registry keys to a code, as a member reads them. */
function copyFor(payload: unknown) {
  const copy = explainHandledError(readHandledError(payload)!);
  expect(copy.isRegistered).toBe(true);
  return copy;
}

describe("the Custom query page", () => {
  describe("given a deployment with no governed SQL provisioning", () => {
    describe("when the member looks for the surface", () => {
      /** @scenario "The workbench is unreachable while governed SQL is not provisioned" */
      it("offers no navigation entry", () => {
        harness.available = false;
        harness.reason = "unprovisioned";
        renderMenuLink();

        expect(
          screen.queryByRole("link", { name: "Custom query" }),
        ).not.toBeInTheDocument();
      });

      /** @scenario "The workbench is unreachable while governed SQL is not provisioned" */
      it("renders the backend's unavailable state instead of the workbench", async () => {
        harness.available = false;
        harness.reason = "unprovisioned";
        renderPage();

        const copy = copyFor(governedSqlUnavailablePayload());
        expect(await screen.findByText(copy.title)).toBeInTheDocument();
        expect(
          screen.queryByTestId("governed-sql-workbench"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a project whose feature switch is off", () => {
    describe("when the member opens the route directly", () => {
      /** @scenario "The whole surface stays dark until the experimental feature switch is on" */
      it("says the switch is off rather than blaming the deployment", async () => {
        harness.available = false;
        harness.reason = "disabled";
        renderPage();

        const switchedOff = copyFor(governedSqlNotEnabledPayload());
        const unprovisioned = copyFor(governedSqlUnavailablePayload());
        expect(switchedOff.title).not.toBe(unprovisioned.title);

        expect(await screen.findByText(switchedOff.title)).toBeInTheDocument();
        expect(screen.queryByText(unprovisioned.title)).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("governed-sql-workbench"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a member whose role lacks the analytics permission", () => {
    describe("when they open the route directly", () => {
      /** @scenario "A member without the analytics permission cannot reach the workbench" */
      it("renders the permission guard rather than the workbench", () => {
        harness.hasPermission = false;
        renderPage();

        expect(screen.getByText("Access Restricted")).toBeInTheDocument();
        expect(
          screen.queryByTestId("governed-sql-workbench"),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("Custom query")).not.toBeInTheDocument();
      });
    });
  });

  describe("given an authorized member on a provisioned deployment", () => {
    describe("when they open the page", () => {
      /** @scenario "An authorized member opens Custom query and sees only their live governed schema" */
      it("names the page and identifies the editor as governed ClickHouse SQL", async () => {
        renderPage();

        expect(screen.getByText("Custom query")).toBeInTheDocument();
        expect(
          await screen.findByText("Governed · project-scoped"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("governed-sql-workbench"),
        ).toBeInTheDocument();
      });

      /** @scenario "The workbench is unreachable while governed SQL is not provisioned" */
      it("offers the navigation entry only once the backend says it is available", () => {
        renderMenuLink();

        expect(
          screen.getByRole("link", { name: "Custom query" }),
        ).toHaveAttribute("href", "/my-project/analytics/query");
      });
    });
  });
});
