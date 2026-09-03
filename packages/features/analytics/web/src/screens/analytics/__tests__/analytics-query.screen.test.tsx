/**
 * @vitest-environment jsdom
 *
 * Both gates on the Custom query surface, and both are server answers: the
 * permission guard, and the deployment's provisioning. Neither can be turned on
 * from the browser, which is the point of the first scenario below.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomQueryMenuLink } from "../../../ui/sections/custom-query-menu-link";
import { lwqlNotEnabledPayload, lwqlUnavailablePayload } from "../../../model/lwql-failure";

import { SCHEMA_RESPONSE } from "../../../__tests__/lwql-fixtures";
import { readHandledError } from "../../../model/handled-error";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing";

const harness = vi.hoisted(() => ({
  available: true,
  reason: undefined as "disabled" | "unprovisioned" | undefined,
  hasPermission: true,
}));

vi.mock("../../../behavior/analytics-api", () => ({
  analyticsApi: {
    useUtils: () => ({ client: {} }),
    analytics: {
      lwql: {
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

// Monaco reaches the editor through the code-splitting shim, whose lazy
// boundary never resolves under jsdom. Standing a textarea in for the shim's
// result means the page under assertion is the mounted one rather than one
// held permanently on a loading fallback.
vi.mock("@monaco-editor/react", () => {
  function StubMonacoEditor(props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
  }) {
    return (
      <textarea
        data-testid="stub-monaco"
        aria-label="LangWatchQL ClickHouse SQL"
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
    );
  }

  return { __esModule: true, default: StubMonacoEditor };
});

import CustomQueryPage from "../analytics-query.screen";

const withHost = (children: React.ReactNode) =>
  render(
    <AnalyticsTestHarness
      host={
        new StubAnalyticsHost({
          permissions: harness.hasPermission ? ["analytics:view"] : [],
        })
      }
    >
      {children}
    </AnalyticsTestHarness>,
  );

function renderPage() {
  withHost(<CustomQueryPage />);
}

function renderMenuLink() {
  withHost(<CustomQueryMenuLink projectId="project-1" projectSlug="my-project" />);
}

beforeEach(() => {
  harness.available = true;
  harness.reason = undefined;
  harness.hasPermission = true;
});

/**
 * Which refusal the page is showing, by CODE.
 *
 * `platform/app`'s version resolved the registry's words and compared those;
 * the registry is the application's and does not travel, so the assertion moves
 * to the property the page actually decides — WHICH payload it hands the alert.
 * The two refusals have different remedies (an administrator's switch versus a
 * deployment with nothing to run a statement as), and reading one as the other
 * is exactly what the scenario is about. Asserting on the code rather than the
 * sentence is also the house rule: the message is copy and will change.
 */
function codeOf(payload: unknown): string {
  const handled = readHandledError(payload);
  if (!handled) throw new Error("fixture is not a handled-error payload");
  return handled.code;
}

describe("the Custom query page", () => {
  describe("given a deployment with no LangWatchQL provisioning", () => {
    describe("when the member looks for the surface", () => {
      /** @scenario "An unavailable or disabled deployment does not expose the workbench" */
      it("offers no navigation entry", () => {
        harness.available = false;
        harness.reason = "unprovisioned";
        renderMenuLink();

        expect(screen.queryByRole("link", { name: "Custom query" })).not.toBeInTheDocument();
      });

      /** @scenario "An unavailable or disabled deployment does not expose the workbench" */
      it("renders the backend's unavailable state instead of the workbench", async () => {
        harness.available = false;
        harness.reason = "unprovisioned";
        renderPage();

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(/not available on this deployment/i);
        expect(codeOf(lwqlUnavailablePayload())).toBe("lwql_unavailable");
        expect(screen.queryByTestId("lwql-workbench")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a project whose feature switch is off", () => {
    describe("when the member opens the route directly", () => {
      /** @scenario "An unavailable or disabled deployment does not expose the workbench" */
      it("says the switch is off rather than blaming the deployment", async () => {
        harness.available = false;
        harness.reason = "disabled";
        renderPage();

        // The two refusals are different payloads with different remedies, and
        // reading one as the other is the whole scenario. Their CODES are what
        // the page picks between; the words the reader sees are resolved from
        // those codes by the application's registry.
        expect(codeOf(lwqlNotEnabledPayload())).not.toBe(codeOf(lwqlUnavailablePayload()));
        expect(await screen.findByRole("alert")).toBeInTheDocument();
        expect(screen.queryByTestId("lwql-workbench")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a member whose role lacks the analytics permission", () => {
    describe("when they open the route directly", () => {
      /**
       * @scenario "A member without the analytics permission cannot reach the workbench"
       *
       * THE GUARD IS NOT THIS MODULE'S ANY MORE. `platform/app` wrapped the
       * page in `withPermissionGuard("analytics:view")`; the policy is now
       * stated once in `apps/ui`'s routes section, in front of the same loader
       * registry, and is asserted there —
       * `apps/ui/tests/analytics-page-policy.integration.test.tsx` refuses all
       * nine keys without the grant and admits them with it. What is left to
       * assert here is that the screen carries no second guard of its own, so
       * the policy has exactly one place to be wrong.
       */
      it("carries no guard of its own, leaving the policy to the routes section", () => {
        harness.hasPermission = false;
        renderPage();

        expect(screen.queryByText("Access Restricted")).not.toBeInTheDocument();
        expect(screen.getByText("Custom query")).toBeInTheDocument();
      });
    });
  });

  describe("given an authorized member on a provisioned deployment", () => {
    describe("when they open the page", () => {
      /** @scenario "Organization rules and project permissions govern access" */
      it("names the page and identifies the editor as LangWatchQL ClickHouse SQL", async () => {
        renderPage();

        expect(screen.getByText("Custom query")).toBeInTheDocument();
        expect(await screen.findByText("LangWatchQL · project-scoped")).toBeInTheDocument();
        expect(screen.getByTestId("lwql-workbench")).toBeInTheDocument();
      });

      /** @scenario "An unavailable or disabled deployment does not expose the workbench" */
      it("offers the navigation entry only once the backend says it is available", () => {
        renderMenuLink();

        expect(screen.getByRole("link", { name: "Custom query" })).toHaveAttribute(
          "href",
          "/my-project/analytics/query",
        );
      });
    });
  });
});
