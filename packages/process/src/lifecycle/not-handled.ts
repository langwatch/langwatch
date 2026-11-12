/** Marks a 503 the door answered before any handler ran, so a caller may resend it. */
export const NOT_HANDLED_HEADER = "x-langwatch-not-handled";

/** The value a draining door sets: it takes no new work, so the connection closes with it. */
export const NOT_HANDLED_DRAINING = "draining";
