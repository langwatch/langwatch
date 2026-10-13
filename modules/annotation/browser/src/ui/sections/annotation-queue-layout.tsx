/** Sidebar and counts around the queue walker. */

import type { PropsWithChildren } from "react";

import { useAnnotationSidebarCounts } from "../../behavior/use-annotation-reads.ts";
import { useAnnotationHost } from "../../model/annotation-host.ts";
import { AnnotationSidebar } from "./annotation-sidebar.tsx";

export default function AnnotationsLayout({ children }: PropsWithChildren) {
  const host = useAnnotationHost();
  const project = host.project();
  const reviewer = host.currentUser();

  const sidebarCounts = useAnnotationSidebarCounts({ projectId: project?.id });

  return (
    <AnnotationSidebar
      view="queue"
      projectSlug={project?.slug}
      reviewerName={reviewer?.name ?? null}
      reviewerImage={reviewer?.image ?? null}
      pendingCount={sidebarCounts.pendingCount}
      assignedCount={sidebarCounts.assignedCount}
      queues={sidebarCounts.queues}
      activeQueueSlug={undefined}
      canManageQueues={!host.isLiteMember()}
      onCreateQueue={() => host.navigate(`/${project?.slug}/annotations`)}
      onEditQueue={() => host.navigate(`/${project?.slug}/annotations`)}
    >
      {children}
    </AnnotationSidebar>
  );
}
