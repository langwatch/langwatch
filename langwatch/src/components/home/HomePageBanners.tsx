import { useEffect, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
	isVoiceAgentsBannerSnoozed,
	VoiceAgentsHomeBanner,
} from "./VoiceAgentsHomeBanner";

/**
 * Renders the home-page announcement banner slot. Each banner owns its own
 * per-project snooze key; the slot stays empty once the banner is snoozed.
 *
 * The decision lives here (rather than on the home page directly) so the
 * banners themselves remain self-contained and we can rotate multiple
 * announcements through the slot later without growing `HomePage`.
 */
export function HomePageBanners() {
	const { project } = useOrganizationTeamProject({
		redirectToOnboarding: false,
		redirectToProjectOnboarding: false,
	});
	const projectId = project?.id;

	const [hasMounted, setHasMounted] = useState(false);
	const [voiceSnoozed, setVoiceSnoozed] = useState(false);

	useEffect(() => {
		setHasMounted(true);
	}, []);

	useEffect(() => {
		if (projectId) {
			setVoiceSnoozed(isVoiceAgentsBannerSnoozed(projectId));
		}
	}, [projectId]);

	// SSR / pre-hydration guard: render nothing rather than briefly flashing
	// the banner before the snooze check runs.
	if (!hasMounted || voiceSnoozed) return null;

	// `onDismissed` hides the banner in the same tab the moment the user
	// clicks ✕, instead of waiting for a reload to re-read localStorage.
	return <VoiceAgentsHomeBanner onDismissed={() => setVoiceSnoozed(true)} />;
}
