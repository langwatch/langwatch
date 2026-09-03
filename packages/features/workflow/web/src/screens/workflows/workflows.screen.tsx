/**
 * Every workflow in the project, and the way to make another one.
 *
 * A MOVE of `platform/app/src/pages/[project]/workflows.tsx`. What changed is
 * everything a screen may not own and nothing else:
 *
 * - `DashboardLayout` does not travel. Chrome belongs to the route tree, and
 *   this page is a child of a layout route the composing application serves.
 * - `withPermissionGuard("workflows:view")` is stated by the frontend feature
 *   in front of the loader rather than wrapped around the module here.
 * - THE CARD LINK IS A NAVIGATION, not an anchor. `~/components/ui/link` is the
 *   application's router-aware Link and a feature package may not import a
 *   router; the card asks the host to go to `/:project/studio/:id`, which is the
 *   same address the anchor pointed at and an address `platform/app` still
 *   serves. The `js-inner-menu` guard travels with it — a click inside the row
 *   menu must not also open the studio behind the menu.
 * - `LangyContextTarget` and `workflowContextChip` do NOT travel.
 *   `@langwatch/langy-web` is ungoverned and every consumer compiles its
 *   source, which needs an `es2023` library and a stylesheet declaration this
 *   package would have had to adopt globally. The same loss the me,
 *   automations, agents, analytics and evaluations families each recorded, and
 *   this is the sixth.
 */

import { Grid, Skeleton, Spacer, useDisclosure, VStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Plus, Workflow } from "lucide-react";
import type { MouseEvent } from "react";

import { workflowApi } from "../../behavior/workflow-api";
import { useWorkflowHost } from "../../model/workflow-host";
import { NoDataInfoBlock } from "../../ui/elements/no-data-info-block";
import { WorkflowCreateDialogHost } from "../../ui/sections/workflow-create-dialog-host";
import { WorkflowListCard } from "../../ui/sections/workflow-list-card";

/** The grant the platform page asked for, unchanged. */
export const WORKFLOWS_PAGE_PERMISSION = "workflows:view";

/**
 * Whether this click landed inside the card's own overflow menu.
 *
 * The menu is rendered INSIDE the card, so a click on "Delete" is also a click
 * on the card. Walking up to the marker class is what tells the two apart, and
 * it is the platform page's own guard, kept.
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
