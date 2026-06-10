import { useEffect, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
	isTracesV2BannerSnoozed,
	TracesV2HomeBanner,
} from "./TracesV2HomeBanner";
import {
	isVoiceAgentsBannerSnoozed,
	VoiceAgentsHomeBanner,
} from "./VoiceAgentsHomeBanner";

type BannerChoice = "traces-v2" | "voice-agents" | null;

/**
 * Picks ONE home-page announcement banner to render at a time. Each banner
 * owns its own per-project snooze key:
 *
 * - If both are eligible (neither snoozed), flip a coin per mount so the two
 *   launches share the slot 50/50 instead of one always crowding the other.
 * - If only one is eligible, render it.
 * - If both are snoozed, render nothing.
 *
 * The choice is captured ONCE per mount in `useState`'s lazy initializer so
 * the coin flip survives re-renders triggered by snooze callbacks. When the
 * user dismisses the currently-shown banner, we re-evaluate and hand the
 * slot to the other one in the same tab (no reload needed).
 *
 * The decision lives here (rather than on the home page directly) so the
 * banners themselves remain self-contained and we can add a third in the
 * lineup later without growing `HomePage`.
 */
export function HomePageBanners() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;

	const [hasMounted, setHasMounted] = useState(false);
	const [tracesSnoozed, setTracesSnoozed] = useState(false);
	const [voiceSnoozed, setVoiceSnoozed] = useState(false);
	// Stable coin flip captured once per mount — used as a tiebreak ONLY when
	// both banners are eligible. `Math.random()` is fine in a lazy initializer
	// since it runs on the client after hydration (we gate render on
	// `hasMounted`), so SSR can't see the value.
	const [coinFlipPrefersVoice] = useState(() => Math.random() < 0.5);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (projectId) {
			setTracesSnoozed(isTracesV2BannerSnoozed(projectId));
			setVoiceSnoozed(isVoiceAgentsBannerSnoozed(projectId));
		}
	}, [projectId]);

	// SSR / pre-hydration guard: render nothing rather than briefly flashing
	// the first banner before the snooze check runs.
	if (!hasMounted) return null;

	const choice: BannerChoice =
		tracesSnoozed && voiceSnoozed
			? null
			: tracesSnoozed
				? "voice-agents"
				: voiceSnoozed
					? "traces-v2"
					: coinFlipPrefersVoice
						? "voice-agents"
						: "traces-v2";

	if (choice === null) return null;
	// `onDismissed` lets the parent flip to the OTHER banner in the same tab
	// the moment the user clicks ✕, instead of waiting for a reload to
	// re-read localStorage.
	return choice === "voice-agents" ? (
		<VoiceAgentsHomeBanner onDismissed={() => setVoiceSnoozed(true)} />
	) : (
		<TracesV2HomeBanner onDismissed={() => setTracesSnoozed(true)} />
	);
}
