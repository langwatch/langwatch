import { useEffect, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
	isTracesV2BannerSnoozed,
	TracesV2HomeBanner,
} from "./TracesV2HomeBanner";
import { VoiceAgentsHomeBanner } from "./VoiceAgentsHomeBanner";

/**
 * Picks ONE home-page announcement banner to render at a time, in priority
 * order: traces-v2 first; once dismissed/snoozed, the voice-agents banner
 * takes its slot. Each banner owns its own snooze key, so a user who
 * snoozed traces-v2 a week ago still gets the voice-agents announcement,
 * and snoozing voice-agents doesn't bring traces-v2 back.
 *
 * The decision lives here (rather than on the home page directly) so the
 * banners themselves remain self-contained and we can add a third in the
 * queue later without growing `HomePage`.
 */
export function HomePageBanners() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;

	const [hasMounted, setHasMounted] = useState(false);
	const [tracesSnoozed, setTracesSnoozed] = useState(false);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (projectId) setTracesSnoozed(isTracesV2BannerSnoozed(projectId));
	}, [projectId]);

	// SSR / pre-hydration guard: render nothing rather than briefly flashing
	// the first banner before the snooze check runs.
	if (!hasMounted) return null;

	// Wire `onDismissed` so the moment the user clicks ✕ on traces-v2 the
	// voice banner takes the slot in the same tab. Without this the parent
	// only reads the snooze flag on `projectId` change and the next banner
	// only appears on remount/reload, which reads as a layout bug.
	return tracesSnoozed ? (
		<VoiceAgentsHomeBanner />
	) : (
		<TracesV2HomeBanner onDismissed={() => setTracesSnoozed(true)} />
	);
}
