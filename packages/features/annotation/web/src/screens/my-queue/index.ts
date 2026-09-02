/**
 * The annotation queue WALKER, as the browser application mounts it.
 *
 * ONE ADDRESS: `/:project/annotations/my-queue`. The annotations manifest
 * recorded this key as the one of five that did not move, and gave the reason:
 * the walker does not merely open the trace drawer, it MOUNTS the drawer's
 * conversation view inline — 4,347 lines of `features/traces-v2` that "no
 * package publishes". The traces family moved that tree into
 * `@langwatch/trace-web` afterwards, so the reason is gone: the conversation
 * view, the turn hooks, the legacy-trace adapter and the queue session store
 * are all package exports now, and this screen imports them.
 *
 * WHAT DIED WITH THE MOVE, as the sidebar copy's own docblock promised:
 * `platform/app/src/components/AnnotationsLayout.tsx` and
 * `hooks/useAnnotationQueues.tsx` are DELETED rather than moved. This package
 * already published narrowed copies of both — the sidebar as a presentational
 * component and the queue read as a hook — and the walker was the last thing
 * holding the originals alive. `ui/sections/annotation-queue-layout.tsx` is the
 * reading half the presentational sidebar needed, which is all that was missing.
 *
 * WHAT THE OWNING FRONTEND FEATURE MOUNTS is the same two things the list
 * screen needs: the tRPC Provider this package's hooks run on, and the host
 * port that answers for the project, the reviewer, their grants and membership,
 * the address and the two notices.
 */

import type { ComponentType } from "react";

export type MyQueueScreenLoader = () => Promise<{ default: ComponentType }>;

export const myQueueScreens = {
  myQueue: () => import("./my-queue.screen"),
} as const satisfies Record<string, MyQueueScreenLoader>;

export type MyQueueScreenName = keyof typeof myQueueScreens;
