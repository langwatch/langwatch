/**
 * @vitest-environment jsdom
 *
 * The collapsed suite strip with emoji-named suites.
 *
 * Deliberately a file of its own rather than a block inside
 * SuiteSidebar.integration.test.tsx: that file names the generated database
 * client for a fixture type, which puts it in the datastore lane behind
 * containers and migrations it never touches. This one derives its fixture
 * type from the component's own props instead, so it runs in the component
 * lane, where a test that renders React into jsdom belongs.
 *
 * @see specs/features/suites/collapsible-suite-sidebar.feature
 * @see specs/navigation/project-avatar-initial.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The sidebar mounts VoiceAgentsCallout, which reaches for project context
// and fires tRPC queries this rig does not provide. Same stub the sibling
// suite uses, for the same reason.
vi.mock("../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: vi.fn(() => ({ project: { id: "project_1" } })),
}));

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

import { SUITE_SIDEBAR_COLLAPSED_KEY, SuiteSidebar } from "../ui/sections/suites/suite-sidebar";

type SuiteSidebarProps = ComponentProps<typeof SuiteSidebar>;
type Suite = SuiteSidebarProps["suites"][number];

function makeSuite(overrides: Partial<Suite> & Pick<Suite, "name">): Suite {
  return {
    id: "suite_1",
    projectId: "project_1",
    slug: "critical-path",
    kind: "run_plan",
    scope: null,
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const defaultProps: SuiteSidebarProps = {
  projectSlug: "my-project",
  suites: [],
  selectedSuiteSlug: null,
  onSelectSuite: vi.fn(),
  onRunSuite: vi.fn(),
  onContextMenu: vi.fn(),
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("given a suite and a scenario set whose names begin with an emoji", () => {
  describe("when the sidebar is collapsed to its icon strip", () => {
    /** @scenario "A suite named with an emoji keeps its whole initial in the strip" */
    /** @scenario "An externally reported scenario set is treated the same way" */
    it("shows each whole emoji, because the icon is all that identifies it", () => {
      localStorage.setItem(SUITE_SIDEBAR_COLLAPSED_KEY, "true");

      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <SuiteSidebar
            {...defaultProps}
            suites={[makeSuite({ name: "🚩 Critical Path" })]}
            externalSets={[
              {
                scenarioSetId: "🏭 nightly",
                passedCount: 1,
                failedCount: 0,
                totalCount: 1,
                lastRunTimestamp: 1000,
              },
            ]}
          />
        </ChakraProvider>,
      );

      expect(screen.getByText("🚩")).toBeInTheDocument();
      expect(screen.getByText("🏭")).toBeInTheDocument();
      // Half a surrogate pair is what painted the replacement box, and the
      // assertions above would still pass with a stray one elsewhere in the
      // strip.
      expect(hasLoneSurrogate(container.textContent ?? "")).toBe(false);
    });
  });
});

describe("given an ordinarily named suite", () => {
  it("still shows its uppercased first letter", () => {
    localStorage.setItem(SUITE_SIDEBAR_COLLAPSED_KEY, "true");

    render(
      <ChakraProvider value={defaultSystem}>
        <SuiteSidebar {...defaultProps} suites={[makeSuite({ name: "critical path" })]} />
      </ChakraProvider>,
    );

    expect(screen.getByText("C")).toBeInTheDocument();
  });
});

/** True when any UTF-16 surrogate in the string is missing its partner. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
