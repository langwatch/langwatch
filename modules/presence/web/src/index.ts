export { PresenceAvatar, type PresenceAvatarProps } from "./presence-avatar.tsx";
export { PresenceAvatarStack, type PresenceAvatarStackProps } from "./presence-avatar-stack.tsx";
export { PresenceMarker, type PresenceMarkerProps } from "./presence-marker.tsx";
export { PresenceSection, type PresenceSectionProps } from "./presence-section.tsx";
export { SectionPresenceDot, type SectionPresenceDotProps } from "./section-presence-dot.tsx";
export { TracePresenceAvatars, type TracePresenceAvatarsProps } from "./trace-presence-avatars.tsx";
export {
  usePresenceStore,
  selectPeerSessions,
  selectPeersOnTrace,
  selectPeersOnConversation,
  selectPeersMatching,
} from "./presence-store.ts";
export { usePresencePreferencesStore } from "./presence-preferences-store.ts";
export {
  resolvePresenceAvailability,
  type PresenceAvailability,
  type PresenceDisabledScope,
} from "./presence-availability.ts";
export { useSectionTrackerStore, selectMostVisibleSection } from "./section-tracker-store.ts";
export {
  presenceUserDisplayName,
  presenceUserColor,
  presenceDisplayName,
  presenceSessionColor,
} from "./presence-user-color.ts";
export { useTabSessionId } from "./use-tab-session-id.ts";
