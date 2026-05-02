/**
 * Shared state helpers for the Trace Explorer promo surfaces (the in-app
 * trace-page banner in `NewTracesPromo` and the homepage banner in
 * `TracesV2HomeBanner`). Extracted so dismissal / Crisp / mailto behaviour
 * stays in lockstep across both surfaces — when one banner changes we don't
 * want the other to silently drift.
 */

const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

export const TRACE_PROMO_SNOOZE_DAYS = SNOOZE_DAYS;

export type TracesPromoMode = "try" | "request";

/**
 * Per-surface dismissal store. `prefix` is versioned (e.g. `:v9:`) so a copy
 * change can invalidate prior snoozes without touching this module.
 */
export interface TracesPromoSnoozeStore {
	prefix: string;
}

const buildKey = (
	store: TracesPromoSnoozeStore,
	projectId: string,
	mode: TracesPromoMode,
) => `${store.prefix}${mode}:${projectId}`;

export function isPromoSnoozed(
	store: TracesPromoSnoozeStore,
	projectId: string,
	mode: TracesPromoMode,
): boolean {
	if (typeof window === "undefined") return false;
	try {
		const raw = localStorage.getItem(buildKey(store, projectId, mode));
		if (!raw) return false;
		const expiresAt = Number(raw);
		if (!Number.isFinite(expiresAt)) return false;
		return expiresAt > Date.now();
	} catch {
		return false;
	}
}

export function snoozePromo(
	store: TracesPromoSnoozeStore,
	projectId: string,
	mode: TracesPromoMode,
): void {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(
			buildKey(store, projectId, mode),
			String(Date.now() + SNOOZE_MS),
		);
	} catch {
		// Best-effort dismissal — quota errors / private mode shouldn't crash the page.
	}
}

/**
 * Best-effort attempt to open the Crisp chat widget. Returns true when Crisp
 * was present and the open command was queued, so callers can suppress the
 * mailto fallback (e.g. by calling `event.preventDefault()`).
 */
export function openCrispChat(): boolean {
	if (typeof window === "undefined") return false;
	const crisp = (
		window as unknown as { $crisp?: { push: (args: unknown[]) => void } }
	).$crisp;
	if (!crisp) return false;
	crisp.push(["do", "chat:show"]);
	crisp.push(["do", "chat:toggle"]);
	return true;
}

/**
 * Mailto fallback used when Crisp isn't installed. Kept here so the subject
 * and body stay identical across both promo surfaces.
 */
export function buildTraceExplorerEarlyAccessMailto(
	projectSlug: string | undefined,
): string {
	const subject = encodeURIComponent(
		"Early access to the new Trace Explorer",
	);
	const body = encodeURIComponent(
		"Hi! I'd like early access to the new Trace Explorer" +
			(projectSlug ? ` for project "${projectSlug}"` : "") +
			".",
	);
	return `mailto:support@langwatch.ai?subject=${subject}&body=${body}`;
}
