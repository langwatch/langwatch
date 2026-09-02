/**
 * The annotations sidebar, around the queue walker.
 *
 * `platform/app`'s `AnnotationsLayout` was BOTH the sidebar and the counts it
 * shows: one component that read the three badge queries itself and wrapped
 * whatever page mounted it. This package already publishes the sidebar as a
 * presentational component (`AnnotationSidebar`), which the list screen feeds
 * from its own reads — so what was missing for the walker was the reading half,
 * and this is it. The platform component and its hook are DELETED rather than
 * moved: the sidebar copy's own docblock said "the two die together when it
 * does", and this is that.
 *
 * NO ENTRY IS MARKED ACTIVE, and that is the platform layout's own behaviour:
 * it compared `usePathname()` to each entry's href, and `/annotations/my-queue`
 * is not one of them. `view="queue"` with no active slug reproduces it exactly.
 */

import type { PropsWithChildren } from "react";

import { annotationApi } from "../../behavior/annotation-api";
import { useAnnotationHost } from "../../model/annotation-host";
import { AnnotationSidebar } from "./annotation-sidebar";

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
      pendingCount={pendingCount.data}
      assignedCount={assignedCount.data}
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
