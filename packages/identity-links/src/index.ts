export {
  EMAIL_EXTERNAL_KINDS,
  EXTERNAL_KINDS_BY_PROVIDER,
  LINK_ORDERING,
  LINK_SOURCES,
  isEmailKind,
  type ExternalKind,
  type LinkProvider,
  type LinkSource,
} from "./constants";
export type {
  AppendLinkInput,
  EraseIdentifiersInput,
  EraseIdentifiersResult,
  IdentityLinkRow,
  LoginRef,
} from "./types";
export type { IdentityLinkStorage } from "./storage";
export {
  resolveOwnerAt,
  splitPeriodByOwnership,
  type LinkTimelineRow,
  type LoginResolution,
  type OwnershipSegment,
} from "./resolution";
