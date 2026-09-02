/**
 * Which of the four annotation lists a page key means, and the words that go
 * with it.
 *
 * FOUR KEYS, ONE SCREEN, AND THE VIEW ARRIVES AS A PROP. `platform/app` had
 * four page files whose bodies differed only in the props they handed one
 * table; the route table already gives each address its own page key, so
 * `apps/ui` maps a key to a view and the screen never reads the address to
 * learn what the router already knew. That is the automations family's
 * tab-as-prop shape, applied to a list rather than to tabs, and it is why the
 * host port has no `pathname`: the sidebar marks its own entry from the view it
 * was given.
 *
 * The one view that still reads the address is `queue`, and it reads a route
 * PARAMETER (`:slug`) rather than the path — the router captured it, so the
 * screen asks for the capture rather than parsing the URL back apart.
 */

/** One of the four annotation lists. */
export type AnnotationView = "inbox" | "mine" | "all" | "queue";

/**
 * What a view puts on screen when it has nothing to show, and what it calls its
 * date column.
 *
 * Every string here is the one `platform/app`'s four page files passed as a
 * prop, moved rather than rewritten. `heading` is absent for `queue` because
 * that page renders the queue's name and its members instead, which is a node
 * rather than a string.
 */
export type AnnotationViewCopy = {
  heading?: string;
  noDataTitle: string;
  noDataDescription: string;
  /** Column heading for a row's date, and the same label in the export. */
  dateColumnLabel: string;
  /** Pending / Completed / All. Off where a row is not queued work. */
  showStatusFilter: boolean;
  /** Where a row that is still waiting takes the reviewer. */
  rowTarget: "queueItem" | "trace";
};

const VIEW_COPY: Record<AnnotationView, AnnotationViewCopy> = {
  inbox: {
    heading: "Inbox",
    noDataTitle: "Your inbox is empty",
    noDataDescription: "Send messages to your annotation queue to get started.",
    dateColumnLabel: "Date queued",
    showStatusFilter: true,
    rowTarget: "queueItem",
  },
  mine: {
    heading: "My Queue",
    noDataTitle: "No queued annotations for you",
    noDataDescription: "You have no annotations assigned to you.",
    dateColumnLabel: "Date queued",
    showStatusFilter: true,
    rowTarget: "queueItem",
  },
  all: {
    heading: "All Annotations",
    noDataTitle:
      "No recent annotations yet, change the date range to see more or annotate your messages",
    noDataDescription: "Annotate your messages to add more context and improve your analysis.",
    dateColumnLabel: "Date annotated",
    showStatusFilter: false,
    rowTarget: "trace",
  },
  queue: {
    noDataTitle: "No queued annotations for this queue",
    noDataDescription: "Add a message to this queue to get started.",
    dateColumnLabel: "Date queued",
    showStatusFilter: true,
    rowTarget: "queueItem",
  },
};

/** The copy and the list behaviour one view carries. */
export function annotationViewCopy(view: AnnotationView): AnnotationViewCopy {
  return VIEW_COPY[view];
}

/**
 * Whether this view reads the reviewer's own inbox as well as the queues they
 * are on.
 *
 * The Inbox is the one list that spans both, which is what
 * `showQueueAndUser` said on the platform page.
 */
export function viewReadsMemberQueues(view: AnnotationView): boolean {
  return view === "inbox";
}
