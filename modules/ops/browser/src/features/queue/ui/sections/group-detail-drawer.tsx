import { CodeBlock } from "@chakra-ui/react";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Drawer } from "@langwatch/design-system/drawer";
import { useShikiAdapter } from "@langwatch/design-system/shiki";
import { useState } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import {
  grafanaGroupLogsUrl,
  grafanaGroupTracesUrl,
  grafanaTraceUrl,
} from "../../../../model/grafana-links.ts";
import { useGroupActions } from "../../behavior/use-group-actions.ts";
import { GroupDrawerHeader } from "../elements/queue-group-drawer-header.tsx";
import { GroupActionConfirms, GroupDrawerActions } from "./group-action-confirms.tsx";
import { GroupDetailContent } from "./queue-group-detail-content.tsx";

interface Props {
  queueName?: string;
  groupId?: string;
  onClose: () => void;
}

const JOBS_PAGE_SIZE = 20;

/**
 * A drawer for one queue group, addressed by `?group=<queue>|<id>` - paste
 * the URL and the same group is open. Owns its own queries and mutations
 * rather than callbacks: the group is a resource, not a table-state slice.
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
