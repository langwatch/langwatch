import { CodeBlock } from "@chakra-ui/react";
import { useState } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { useShikiAdapter } from "~/features/traces-v2/components/TraceDrawer/markdownView/shikiAdapter";
import { useDrawer } from "~/hooks/useDrawer";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import {
  grafanaGroupLogsUrl,
  grafanaGroupTracesUrl,
} from "~/utils/grafanaLinks";
import { GroupActionConfirms, GroupDrawerActions } from "./GroupActionConfirms";
import { GroupDetailContent } from "./GroupDetailContent";
import { GroupDrawerHeader } from "./GroupDrawerHeader";
import { useGroupActions } from "./useGroupActions";

interface Props {
  queueName?: string;
  groupId?: string;
}

const JOBS_PAGE_SIZE = 20;

/**
 * URL-routed drawer for one queue group (see dev/docs/best_practices/drawers.md
 * — paste the URL and the same group is open). Owns its own queries and
 * mutations rather than receiving callbacks: it is mounted by CurrentDrawer,
 * far from the table that opened it.
 */
export function GroupDetailDrawer({ queueName = "", groupId = "" }: Props) {
  const { closeDrawer } = useDrawer();
  const { hasAccess } = useOpsPermission();
  const { colorMode } = useColorMode();
  const shikiAdapter = useShikiAdapter(colorMode);

  const enabled = !!queueName && !!groupId;
  const target = { queueName, groupId };

  const [jobsPage, setJobsPage] = useState(1);
  const [jobFilter, setJobFilter] = useState("");

  const detailQuery = api.ops.getGroupDetail.useQuery(target, { enabled });
  const jobsQuery = api.ops.getGroupJobs.useQuery(
    { ...target, page: jobsPage, pageSize: JOBS_PAGE_SIZE },
    { enabled },
  );
  const grafanaQuery = api.ops.getGrafanaLinkConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const grafana = grafanaQuery.data ?? null;

  const detail = detailQuery.data ?? null;
  const actions = useGroupActions(target);

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <GroupDrawerHeader
            groupId={groupId}
            tracesUrl={grafana ? grafanaGroupTracesUrl(groupId, grafana) : null}
            logsUrl={grafana ? grafanaGroupLogsUrl(groupId, grafana) : null}
            onCopyGroupId={actions.copyGroupId}
          />
        </Drawer.Header>
        <Drawer.Body>
          <CodeBlock.AdapterProvider value={shikiAdapter}>
            <GroupDetailContent
              detail={detail}
              // isPending, not isLoading: a disabled query reports isLoading
              // false, which would flash the "no longer exists" state before
              // the fetch starts.
              isLoading={detailQuery.isPending}
              jobs={jobsQuery.data ?? null}
              jobsLoading={jobsQuery.isPending}
              jobsPage={jobsPage}
              jobsPageSize={JOBS_PAGE_SIZE}
              onJobsPageChange={setJobsPage}
              jobFilter={jobFilter}
              onJobFilterChange={setJobFilter}
              grafana={grafana}
              now={detailQuery.dataUpdatedAt || undefined}
            />
          </CodeBlock.AdapterProvider>
        </Drawer.Body>
        {hasAccess && detail && (
          <Drawer.Footer>
            <GroupDrawerActions
              target={target}
              actions={actions}
              isBlocked={detail.isBlocked}
            />
          </Drawer.Footer>
        )}
        <Drawer.CloseTrigger />
      </Drawer.Content>

      <GroupActionConfirms target={target} actions={actions} />
    </Drawer.Root>
  );
}
