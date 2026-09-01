import { CodeBlock } from "@chakra-ui/react";
import { useState } from "react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { GroupDrawerHeader } from "../elements/queue-group-drawer-header";
import { GroupDetailContent } from "./queue-group-detail-content";
import { Drawer } from "@langwatch/design-system/drawer";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { useOpsPermission } from "../../../../behavior/ops-session";
import { api } from "../../../../behavior/ops-api";
import {
  grafanaGroupLogsUrl,
  grafanaGroupTracesUrl,
  grafanaTraceUrl,
} from "../../../../model/grafana-links";
import { GroupActionConfirms, GroupDrawerActions } from "./group-action-confirms";
import { useGroupActions } from "../../behavior/use-group-actions";

interface Props {
  queueName?: string;
  groupId?: string;
  onClose: () => void;
}

const JOBS_PAGE_SIZE = 20;

/**
 * A drawer for one queue group, addressed by the groups table's own
 * `?group=<queue>|<id>` — paste the URL and the same group is open. It owns its
 * own queries and mutations rather than receiving callbacks, which is what it
 * did under the application drawer registry and stays true now that the table
 * renders it: the group is a resource, not a slice of the table's state.
 */
export function GroupDetailDrawer({ queueName = "", groupId = "", onClose }: Props) {
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
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={() => onClose()}>
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
              traceUrlForTraceId={(traceId) => (grafana ? grafanaTraceUrl(traceId, grafana) : null)}
              now={detailQuery.dataUpdatedAt || undefined}
            />
          </CodeBlock.AdapterProvider>
        </Drawer.Body>
        {hasAccess && detail && (
          <Drawer.Footer>
            <GroupDrawerActions target={target} actions={actions} isBlocked={detail.isBlocked} />
          </Drawer.Footer>
        )}
        <Drawer.CloseTrigger />
      </Drawer.Content>

      <GroupActionConfirms target={target} actions={actions} />
    </Drawer.Root>
  );
}
