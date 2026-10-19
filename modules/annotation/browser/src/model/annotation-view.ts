/**
 * Which of the four annotation lists a page key means, and the words that go
 * with it. The view arrives as a prop; only `queue` reads a route parameter.
 */

/** One of the four annotation lists. */
export type AnnotationView = "inbox" | "mine" | "all" | "queue";

/**
 * What a view puts on screen when it has nothing to show, and what it calls its
 * date column. `heading` is absent for `queue`, which renders the queue itself.
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

/** Whether this view reads the reviewer's own items and every queue they are on. */
export function viewReadsMemberQueues(view: AnnotationView): boolean {
  return view === "inbox";
}
