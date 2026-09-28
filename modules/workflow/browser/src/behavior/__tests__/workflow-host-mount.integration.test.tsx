// @vitest-environment jsdom
/**
 * The workflows list threw "No workflow host is mounted" until workflow declared its mount.
 * Spec: specs/ui/module-host-mounting.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  UiCapabilityContextProvider,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import {
  createUiScopeHost,
  type UiScopeHost,
} from "@langwatch/browser-host/use-organization-team-project";
import { installedModuleHostMounts } from "@langwatch/ui-kernel/module-hosts";
import { useWorkflowHost } from "@langwatch/workflow-browser-kit";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listed = vi.fn((_input: { projectId: string }) => ({ data: [], isLoading: false }));
vi.mock("@langwatch/browser-trpc/workflow-api", () => ({
  api: { workflow: { getAll: { useQuery: (input: { projectId: string }) => listed(input) } } },
}));
vi.mock("../../ui/sections/workflow-create-dialog-host.tsx", () => ({
  WorkflowCreateDialogHost: () => null,
}));

import WorkflowsScreen from "../../ui/sections/workflows/workflows-screen.tsx";
import { workflowWeb } from "../../workflow.web.ts";

class TestScope extends UiScope {
  constructor(private readonly host: UiScopeHost) {
    super();
  }

  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }

  scopeHost(): UiScopeHost {
    return this.host;
  }
}

const navigated = vi.fn();

/** What the shell's stack renders for workflow: the mount its declaration loads. */
async function declaredMount(): Promise<ComponentType<{ children?: ReactNode }>> {
  const mounts = installedModuleHostMounts([workflowWeb]);
  const mount = mounts.find((candidate) => candidate.host === "WorkflowHostApi");
  if (!mount) throw new Error("workflow declares no WorkflowHostApi mount");
  const loaded = await mount.load();
  if (!isProviderModule(loaded)) throw new Error("the mount loads no provider component");
  return loaded.default;
}

function isProviderModule(
  value: unknown,
): value is { default: ComponentType<{ children?: ReactNode }> } {
  if (typeof value !== "object" || value === null || !("default" in value)) return false;
  return typeof value.default === "function";
}

async function renderUnderMount(children: ReactNode) {
  const Mount = await declaredMount();
  const scopeHost = createUiScopeHost({
    project: () => ({ id: "proj-1", slug: "demo", name: "Demo" }),
    organization: () => ({ id: "org-1" }),
    team: () => ({ id: "team-1" }),
    hasPermission: () => true,
  });
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: { project: "demo" }, query: {}, pathname: "/demo/workflows" }),
      navigate: navigated,
    }),
    scope: new TestScope(scopeHost),
  };

  render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider value={capabilities}>
        <Mount>{children}</Mount>
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

/** Stands in for experiment's replicate dialog, a peer reading workflow's port. */
function PeerReader() {
  const host = useWorkflowHost();
  const scope = host.scope();
  return (
    <span>
      {scope.projectSlug}/{scope.teamId}/{String(scope.isResolved)}/{host.copyTargets().length}
    </span>
  );
}

afterEach(() => {
  cleanup();
  listed.mockClear();
});

describe("given the workflow module's declared host mount", () => {
  describe("when a customer opens the workflows list under it", () => {
    /** @scenario "A module's host is mounted above the page that reads it" */
    it("renders the list for the scoped project rather than throwing", async () => {
      await renderUnderMount(<WorkflowsScreen />);

      expect(await screen.findByText("No workflows yet")).toBeTruthy();
      expect(listed).toHaveBeenCalledWith({ projectId: "proj-1" });
    });
  });

  describe("when a peer module's screen reads the same port", () => {
    /** @scenario "A mounted host answers the reading its screen renders from" */
    it("answers the scope from the capabilities, and no copy target it cannot know", async () => {
      await renderUnderMount(<PeerReader />);

      expect(await screen.findByText("demo/team-1/true/0")).toBeTruthy();
    });
  });
});
