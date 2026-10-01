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
 * Dataset's Replicate dialog offers only projects the reader may create datasets in.
 * Spec: specs/datasets/datasets-list-page.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { installedModuleHostMounts } from "@langwatch/ui-kernel/module-hosts";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../dataset-api.ts", () => ({
  datasetApi: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => Promise.resolve() } } }),
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    useUtils: () => ({ dataset: { getAll: { invalidate: () => Promise.resolve() } } }),
    dataset: {
      copy: { useMutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }) },
    },
  },
}));

import { datasetWeb } from "../../dataset.web.ts";
import { CopyDatasetDialog } from "../../ui/sections/copy-dataset-dialog.tsx";

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

/** Stands in for organization's lent capability: one project open, one closed. */
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
        label: "Acme / Finance / Batch",
        mayCreate: false,
      },
    ];
  }
}

async function declaredMount(): Promise<ComponentType<{ children?: ReactNode }>> {
  const mount = installedModuleHostMounts([datasetWeb]).find(
    (candidate) => candidate.host === "DatasetHostApi",
  );
  if (!mount) throw new Error("dataset declares no DatasetHostApi mount");
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

afterEach(cleanup);

describe("given a reader who may create datasets in one of their projects and not in another", () => {
  describe("when they open the dataset replicate dialog", () => {
    /** @scenario "Replicating a dataset offers only the projects I may create datasets in" */
    /** @scenario "Replication targets are the teams the reader may create datasets in" */
    it("offers only the project they may create datasets in", async () => {
      const Mount = await declaredMount();
      const lent = new LentCopyTargets();
      const capabilities: UiCapabilities = {
        ...createUiCapabilitiesFromHost({
          route: () => ({ params: { project: "demo" }, query: {}, pathname: "/demo/datasets" }),
          navigate: vi.fn(),
        }),
        scope: new TestScope(
          createUiScopeHost({
            project: () => ({ id: "proj-1", slug: "demo", name: "Demo" }),
            organization: () => ({ id: "org-1" }),
            team: () => ({ id: "team-1" }),
            hasPermission: () => true,
          }),
        ),
        copyTargets: lent,
      };
      const user = userEvent.setup({ pointerEventsCheck: 0 });

      renderWithDesignSystem(
        <UiCapabilityContextProvider value={capabilities}>
          <Mount>
            <CopyDatasetDialog open onClose={vi.fn()} datasetId="ds-1" datasetName="Golden" />
          </Mount>
        </UiCapabilityContextProvider>,
      );

      await user.click(await screen.findByRole("combobox"));

      expect(
        await screen.findAllByRole("option", {
          name: /Acme \/ Engineering \/ Web App/,
          hidden: true,
        }),
      ).not.toHaveLength(0);
      expect(screen.queryAllByRole("option", { name: /Batch/, hidden: true })).toHaveLength(0);
      expect(lent.asked).toContain("datasets:create");
    });
  });
});
