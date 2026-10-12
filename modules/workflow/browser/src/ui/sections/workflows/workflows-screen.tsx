/**
 * Every workflow in the project, and the way to make another. Its guard is
 * declared in workflow.web.ts; `LangyContextTarget` does NOT travel since
 * `@langwatch/langy-browser` is ungoverned.
 */

import { ListPage } from "@langwatch/design-system/list-page";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Grid, Skeleton, useDisclosure } from "@langwatch/design-system/primitives";
import { Plus, Workflow } from "lucide-react";
import type { MouseEvent } from "react";

import { workflowApi } from "../../../behavior/workflow-api.ts";
import { useWorkflowHost } from "../../../model/workflow-host.ts";
import { WorkflowCreateDialogHost } from "../workflow-create-dialog-host.tsx";
import { WorkflowListCard } from "../workflow-list-card.tsx";

const WORKFLOWS_DOCS = "https://docs.langwatch.ai/workflows/overview";

/**
 * Whether this click landed inside the card's own overflow menu. The menu
 * renders INSIDE the card, so "Delete" is also a card click; walking up to
 * the marker class tells them apart (the platform page's guard, kept).
 */
function isInnerMenuClick(event: MouseEvent<HTMLElement>): boolean {
  let target = event.target as HTMLElement | null;
  while (target?.parentElement) {
    if (target.classList.contains("js-inner-menu")) return true;
    target = target.parentElement;
  }
  return false;
}

export default function WorkflowsScreen() {
  const host = useWorkflowHost();
  const { projectId, projectSlug } = host.scope();
  const { open, onClose, onOpen } = useDisclosure();

  const workflows = workflowApi.workflow.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const hasWorkflows = workflows.data && workflows.data.length > 0;
  const showEmptyState = !workflows.isLoading && !hasWorkflows;

  return (
    <>
      {/* Loading stays "ready": the tile skeletons below are the loading look. */}
      <ListPage
        title="Workflows"
        actions={
          <PageLayout.HeaderButton primary data-testid="workflow-new-open" onClick={onOpen}>
            <Plus size={16} /> New workflow
          </PageLayout.HeaderButton>
        }
        state={showEmptyState ? "empty" : "ready"}
        empty={{
          title: "No workflows yet",
          description: "Create reusable workflows with the workflow studio.",
          icon: <Workflow size={24} />,
          primaryAction: (
            <PageLayout.HeaderButton primary onClick={onOpen}>
              <Plus size={16} /> Create your first workflow
            </PageLayout.HeaderButton>
          ),
          next: [{ kind: "docs", label: "Read about workflows", href: WORKFLOWS_DOCS }],
        }}
      >
        <Grid templateColumns="repeat(auto-fill, minmax(260px, 1fr))" gap={6} width="full">
          {workflows.isLoading &&
            Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} height="200px" />)}
          {workflows.data?.map((workflow) => (
            <WorkflowListCard
              key={workflow.id}
              workflowId={workflow.id}
              workflows={workflows.data}
              name={workflow.name}
              icon={workflow.icon}
              data-testid={`workflow-card-${workflow.name}`}
              onClick={(event: MouseEvent<HTMLElement>) => {
                if (isInnerMenuClick(event)) {
                  event.stopPropagation();
                  event.preventDefault();
                  return;
                }
                host.navigate(`/${projectSlug ?? ""}/studio/${workflow.id}`);
              }}
            />
          ))}
        </Grid>
      </ListPage>

      <WorkflowCreateDialogHost open={open} onClose={onClose} />
    </>
  );
}
