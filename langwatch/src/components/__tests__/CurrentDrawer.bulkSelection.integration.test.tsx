/**
 * @vitest-environment jsdom
 *
 * Regression test for bulk add-to-dataset selections.
 *
 * Drawer state lives in the URL as comma-serialized arrays, and qs.parse's
 * default arrayLimit is 20: selecting more than 20 traces made
 * `drawer.selectedTraceIds` parse into an index-keyed OBJECT instead of an
 * array, the add-to-dataset drawer forwarded that object to the traces query,
 * zod rejected it, and the mapping preview never rendered. This renders the
 * real CurrentDrawer against a 25-id URL and asserts the drawer component
 * receives a plain string array.
 * See specs/datasets/add-to-dataset-span-mapping.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const TRACE_IDS = Array.from({ length: 25 }, (_, i) => `trace-${i + 1}`);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    asPath: `/test-project/messages?drawer.open=addDatasetRecord&drawer.selectedTraceIds=${TRACE_IDS.join(",")}`,
    pathname: "/[project]/messages",
    query: {},
    push: vi.fn(),
    replace: vi.fn(),
  }),
  default: {
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organizationRole: "ADMIN" }),
}));

vi.mock("~/components/drawerRegistry", () => ({
  drawers: {
    addDatasetRecord: (props: Record<string, unknown>) => (
      <div
        data-testid="drawer-probe"
        data-selected-trace-ids={JSON.stringify(props.selectedTraceIds)}
      />
    ),
  },
}));

const { CurrentDrawer } = await import("~/components/CurrentDrawer");

describe("CurrentDrawer bulk trace selection", () => {
  afterEach(() => cleanup());

  describe("when more than twenty traces are selected", () => {
    /** @scenario Bulk-selecting more than twenty traces still opens the preview */
    it("hands the drawer every selected trace id as a string array", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <CurrentDrawer />
        </ChakraProvider>,
      );

      const probe = screen.getByTestId("drawer-probe");
      const ids: unknown = JSON.parse(
        probe.getAttribute("data-selected-trace-ids")!,
      );
      expect(Array.isArray(ids)).toBe(true);
      expect(ids).toEqual(TRACE_IDS);
    });
  });
});
