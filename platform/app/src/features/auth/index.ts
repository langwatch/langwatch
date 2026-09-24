/**
 * The first-party auth screens: every screen a signed-out person can reach
 * (D13, ADR-117). The screens render routing decisions and contain no routing
 * logic of their own — see `logic/routingReasonCopy.ts` for the one place a
 * reason code becomes words.
 *
 * These are the only screens. There is no second set behind a setting any
 * more, and nothing here is asked whether it may render.
 */
export { AuthShell } from "./components/AuthShell";
export { AuthValuePanel } from "./components/AuthValuePanel";
export { IdentifierFirstSignIn } from "./components/IdentifierFirstSignIn";
export { InviteLanding } from "./components/InviteLanding";
export { JoinBeforeCreateInterstitial } from "./components/JoinBeforeCreateInterstitial";
export { JoinInsteadNotice } from "./components/JoinInsteadNotice";
export { SignInMethodPicker } from "./components/SignInMethodPicker";
export { VerificationFirstSignUp } from "./components/VerificationFirstSignUp";
export type {
  JoinableOrganization,
  JoinBeforeCreateDecision,
  JoinBeforeCreateInput,
} from "./logic/joinBeforeCreate";
export { resolveJoinBeforeCreate } from "./logic/joinBeforeCreate";
export type { RoutingReasonCopy } from "./logic/routingReasonCopy";
export { signInRoutingReasonCopy } from "./logic/routingReasonCopy";
