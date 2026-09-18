/** Sidebar and counts around the queue walker. */

import type { PropsWithChildren } from "react";

import { annotationApi } from "../../behavior/annotation-api.ts";
import { useAnnotationHost } from "../../model/annotation-host.ts";
import { AnnotationSidebar } from "./annotation-sidebar.tsx";

export default function AnnotationsLayout({ children }: PropsWithChildren) {
  const host = useAnnotationHost();
  const project = host.project();
  const reviewer = host.currentUser();

  const pendingCount = annotationApi.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const assignedCount = annotationApi.annotation.getAssignedItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const queueBadges = annotationApi.annotation.getQueueItemsCounts.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  return (
    <AnnotationSidebar
      view="queue"
      projectSlug={project?.slug}
      reviewerName={reviewer?.name ?? null}
      reviewerImage={reviewer?.image ?? null}
      pendingCount={pendingCount.data?.count}
      assignedCount={assignedCount.data?.count}
      queues={queueBadges.data ?? []}
      activeQueueSlug={undefined}
      canManageQueues={!host.isLiteMember()}
      onCreateQueue={() => host.navigate(`/${project?.slug}/annotations`)}
      onEditQueue={() => host.navigate(`/${project?.slug}/annotations`)}
    >
      {children}
    </AnnotationSidebar>
  );
}
