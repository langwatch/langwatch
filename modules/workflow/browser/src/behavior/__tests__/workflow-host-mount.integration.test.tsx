import {
  UiCapabilityContextProvider,
  UiCopyTargets,
  UiScope,
  type UiActiveScope,
  type UiCapabilities,
  type UiCopyTarget,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import {
  createUiScopeHost,
  type UiScopeHost,
} from "@langwatch/browser-host/use-organization-team-project";
// @vitest-environment jsdom
/**
 * Workflow's declared mount: the list threw, and Replicate listed nothing, without it.
 * Spec: specs/ui/module-host-mounting.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { installedModuleHostMounts } from "@langwatch/browser/module-hosts";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkflowHost } from "../../model/workflow-host.ts";

const listed = vi.fn((_input: { projectId: string }) => ({ data: [], isLoading: false }));
vi.mock("../workflow-api.ts", () => ({
  workflowApi: {
    useUtils: () => ({ workflow: { getAll: { invalidate: () => Promise.resolve() } } }),
    workflow: {
      getAll: { useQuery: (input: { projectId: string }) => listed(input) },
      copy: { useMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }) },
    },
  },
}));
vi.mock("../../ui/sections/workflow-create-dialog-host.tsx", () => ({
  WorkflowCreateDialogHost: () => null,
}));

import { WorkflowReplicateDialog } from "../../ui/sections/workflow-replicate-dialog.tsx";
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

/** Stands in for organization's lent capability: one open project, one closed. */
class LentCopyTargets extends UiCopyTargets {
  readonly asked: string[] = [];

  targets(permission: string): readonly UiCopyTarget[] {
    this.asked.push(permission);
    return [
      {
        projectId: "proj-2",
        projectSlug: "web-app",
        label: "Acme / Engineering / Web App",
        mayCreate: true,
      },
      {
        projectId: "proj-3",
        projectSlug: "batch",
        label: "Acme / Engineering / Batch",
        mayCreate: false,
      },
    ];
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

async function renderUnderMount(
  children: ReactNode,
  { copyTargets }: { copyTargets?: UiCopyTargets } = {},
) {
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
    copyTargets,
  };

  renderWithDesignSystem(
    <UiCapabilityContextProvider value={capabilities}>
      <Mount>{children}</Mount>
    </UiCapabilityContextProvider>,
  );
}

/** Stands in for experiment's replicate dialog, a peer reading workflow's port. */
function PeerReader() {
  const host = useWorkflowHost();
  const scope = host.scope();
  return (
    <span>
      {scope.projectSlug}/{scope.teamId}/{String(scope.isResolved)}/
      {host.copyTargets({ permission: "evaluations:manage" }).length}
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

  describe("when a customer opens the Replicate dialog under it", () => {
    /** @scenario "Every Replicate dialog lists the targets organization lends" */
    it("lists organization's targets by name and refuses the closed one", async () => {
      const lent = new LentCopyTargets();
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      await renderUnderMount(
        <WorkflowReplicateDialog open onClose={vi.fn()} workflowId="wf-1" workflowName="Bot" />,
        { copyTargets: lent },
      );

      await user.click(await screen.findByRole("combobox"));
      const open = await screen.findAllByRole("option", {
        name: /Acme \/ Engineering \/ Web App/,
        hidden: true,
      });
      const closed = await screen.findAllByRole("option", {
        name: /Acme \/ Engineering \/ Batch/,
        hidden: true,
      });
      const closedItem = closed.find((option) => option.tagName === "DIV");
      if (!closedItem) throw new Error("the closed target renders no option");
      await user.click(closedItem);

      expect(open.length).toBeGreaterThan(0);
      expect(screen.getByText("(no permission)")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Replicate" })).toHaveProperty("disabled", true);
      expect(lent.asked).toContain("workflows:create");
    });
  });
});
