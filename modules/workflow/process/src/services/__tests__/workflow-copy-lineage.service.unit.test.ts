import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  parseStudioWorkflow,
  type Workflow,
  type WorkflowCopiesRow,
  type WorkflowSourceRow,
  type WorkflowVersion,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  WorkflowCopyLineageService,
  type WorkflowCopyLineageServiceOptions,
} from "../workflow-copy-lineage.service.ts";
import type { SaveStudioWorkflowVersionInput } from "../workflow-studio-version.service.ts";

type Options = WorkflowCopyLineageServiceOptions;
type Lineage = Options["lineage"];
type Permissions = Options["permissions"];
type Copies = Options["workflows"];
type StudioVersions = Options["studioVersions"];

const graph = parseStudioWorkflow({
  workflow_id: "source",
  spec_version: "1.4",
  name: "Source graph",
  icon: "x",
  description: "x",
  version: "3",
  nodes: [],
  edges: [],
  state: {},
});

const at = new Date("2026-09-24T00:00:00Z");

function row(overrides: Partial<Workflow> & Pick<Workflow, "id" | "projectId">): Workflow {
  return {
    name: overrides.id,
    icon: null,
    description: null,
    latestVersionId: null,
    currentVersionId: null,
    publishedId: null,
    publishedById: null,
    copiedFromWorkflowId: null,
    isEvaluator: false,
    isComponent: false,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** The rows the lineage reads answer, keyed by workflow id. */
class LineageRows implements Lineage {
  constructor(
    private readonly rows: {
      withSource?: WorkflowSourceRow;
      withCopies?: WorkflowCopiesRow;
      latestVersions?: Record<string, string>;
    } = {},
  ) {}

  findWorkflow(): Promise<{ projectId: string } | null> {
    return Promise.resolve(null);
  }

  findCopiesWithPath(): Promise<null> {
    return Promise.resolve(null);
  }

  findWorkflowWithSource(): Promise<WorkflowSourceRow | null> {
    return Promise.resolve(this.rows.withSource ?? null);
  }

  findWorkflowWithCopies(): Promise<WorkflowCopiesRow | null> {
    return Promise.resolve(this.rows.withCopies ?? null);
  }

  findLatestVersionNumber(input: { workflowId: string }): Promise<{ version: string } | null> {
    const version = this.rows.latestVersions?.[input.workflowId];

    return Promise.resolve(version === undefined ? null : { version });
  }
}

class ProjectGrants implements Permissions {
  constructor(private readonly granted: readonly string[]) {}

  has(input: { projectId: string; permission: AuthzPermission }): Promise<boolean> {
    return Promise.resolve(this.granted.includes(`${input.projectId}:${input.permission}`));
  }
}

class RecordingCopies implements Copies {
  readonly copied: unknown[] = [];

  copy(input: unknown): Promise<never> {
    this.copied.push(input);
    return Promise.reject(new Error("copy is not expected in this example"));
  }
}

class RecordingVersions implements StudioVersions {
  readonly saved: SaveStudioWorkflowVersionInput[] = [];

  saveOrCommit(input: SaveStudioWorkflowVersionInput): Promise<WorkflowVersion> {
    this.saved.push(input);
    return Promise.resolve({
      id: `version_${this.saved.length}`,
      workflowId: input.workflowId,
      projectId: input.projectId,
      version: input.dsl.version,
      autoSaved: input.autoSaved,
      commitMessage: input.commitMessage,
      authorId: input.authorId,
      parentId: null,
      dsl: input.dsl,
      createdAt: at,
      updatedAt: at,
    });
  }
}

function service(options: {
  lineage?: LineageRows;
  granted?: readonly string[];
  copies?: RecordingCopies;
  versions?: RecordingVersions;
}) {
  return WorkflowCopyLineageService.create({
    lineage: options.lineage ?? new LineageRows(),
    permissions: new ProjectGrants(options.granted ?? []),
    workflows: options.copies ?? new RecordingCopies(),
    studioVersions: options.versions ?? new RecordingVersions(),
  });
}

const caller = { id: "user_1" };
const copyRow = row({ id: "copy", projectId: "target", copiedFromWorkflowId: "source" });
const sourceRow = row({ id: "source", projectId: "source_project" });

describe("WorkflowCopyLineageService", () => {
  /** @scenario "Copying from a project the caller cannot create workflows in is refused" */
  it("refuses a copy from an unpermitted source with the 401 it always answered", async () => {
    const copies = new RecordingCopies();

    await expect(
      service({ copies }).copyFromPermittedSource(
        {
          sourceWorkflowId: "source",
          sourceProjectId: "source_project",
          targetProjectId: "target",
          copiedFromWorkflowId: "source",
        },
        caller,
      ),
    ).rejects.toMatchObject({ code: "permission_denied", httpStatus: 401 });
    expect(copies.copied).toEqual([]);
  });

  /** @scenario "A workflow that is not a copy has nothing to sync from" */
  it("refuses to sync a workflow that was never copied as a bad request", async () => {
    const lineage = new LineageRows({
      withSource: {
        ...row({ id: "own", projectId: "target" }),
        latestVersion: null,
        copiedFrom: null,
      },
    });

    await expect(
      service({ lineage }).syncFromSource({ workflowId: "own", projectId: "target" }, caller),
    ).rejects.toMatchObject({ code: "workflow_not_a_copy", httpStatus: 400 });
  });

  /** @scenario "A synced copy continues its own version history" */
  it("writes the source graph into the copy as the copy's next major version", async () => {
    const versions = new RecordingVersions();
    const lineage = new LineageRows({
      withSource: {
        ...copyRow,
        latestVersion: { version: "4.2", dsl: graph },
        copiedFrom: { ...sourceRow, latestVersion: { version: "9", dsl: graph } },
      },
    });

    await service({ lineage, versions, granted: ["source_project:workflows:view"] }).syncFromSource(
      { workflowId: "copy", projectId: "target" },
      caller,
    );

    expect(versions.saved).toMatchObject([
      {
        workflowId: "copy",
        projectId: "target",
        dsl: { workflow_id: "copy", version: "5" },
        commitMessage: "Updated from source workflow",
        authorId: "user_1",
      },
    ]);
  });

  /** @scenario "A push reaching no copy the caller may update is refused" */
  it("refuses a push when every copy is in a project the caller cannot update", async () => {
    const versions = new RecordingVersions();
    const lineage = new LineageRows({
      withCopies: {
        ...sourceRow,
        latestVersion: { version: "9", dsl: graph },
        copiedWorkflows: [{ ...copyRow, latestVersion: null }],
      },
      latestVersions: { copy: "1" },
    });

    await expect(
      service({ lineage, versions }).pushToCopies(
        { workflowId: "source", projectId: "source_project" },
        caller,
      ),
    ).rejects.toMatchObject({ code: "permission_denied", httpStatus: 401 });
    expect(versions.saved).toEqual([]);
  });

  /** @scenario "A push with nothing to push to is refused" */
  it("refuses a push from a workflow without copies as a bad request", async () => {
    const lineage = new LineageRows({
      withCopies: {
        ...sourceRow,
        latestVersion: { version: "9", dsl: graph },
        copiedWorkflows: [],
      },
    });

    await expect(
      service({ lineage }).pushToCopies(
        { workflowId: "source", projectId: "source_project" },
        caller,
      ),
    ).rejects.toMatchObject({ code: "workflow_has_no_copies", httpStatus: 400 });
  });

  /** @scenario "Listing the copies of a missing workflow answers not found" */
  it("answers a listing of an unknown workflow as not found", async () => {
    await expect(
      service({}).listPermittedCopies({ workflowId: "gone", projectId: "target" }, caller),
    ).rejects.toMatchObject({ code: "workflow_not_found", httpStatus: 404 });
  });
});
