/**
 * Every workflow in the project, and the way to make another. A MOVE of
 * `platform/app`'s page: chrome/guard no longer travel. `LangyContextTarget`
 * does NOT travel since `@langwatch/langy-web` is ungoverned.
 */

import { Grid, Skeleton, Spacer, useDisclosure, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus, Workflow } from "lucide-react";
import type { MouseEvent } from "react";

import { workflowApi } from "../../model/workflow-api.ts";
import { useWorkflowHost } from "../../model/workflow-host.ts";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { WorkflowCreateDialogHost } from "../../ui/sections/workflow-create-dialog-host.tsx";
import { WorkflowListCard } from "../../ui/sections/workflow-list-card.tsx";

/** The grant the platform page asked for, unchanged. */
export const WORKFLOWS_PAGE_PERMISSION = "workflows:view";

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
      <PageLayout.Header>
        <PageLayout.Heading>Workflows</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton onClick={onOpen}>
          <Plus size={16} /> New Workflow
        </PageLayout.HeaderButton>
      </PageLayout.Header>

      {showEmptyState ? (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No workflows yet"
              description="Create reusable workflows with the Optimization Studio."
              icon={<Workflow size={24} />}
              color="blue.500"
            >
              <PageLayout.HeaderButton onClick={onOpen} marginTop={4}>
                <Plus size={16} /> Create your first workflow
              </PageLayout.HeaderButton>
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      ) : (
        <VStack gap={6} width="full" align="start" padding={6}>
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
        </VStack>
      )}

      <WorkflowCreateDialogHost open={open} onClose={onClose} />
    </>
  );
}
