/**
 * Sanity cap on one sweep: this large a result means something upstream
 * stopped confirming, not steady-state drift. Applied TWICE — per instance,
 * then again after merging — so the sweep settles at most this cap.
 */
export const MAX_OPEN_ADMISSIONS_PER_SWEEP = 10_000;
