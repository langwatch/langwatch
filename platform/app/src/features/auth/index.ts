/**
 * The first-party auth screens: every screen a signed-out person can reach
 * (D13, ADR-117). The screens render routing decisions and contain no routing
 * logic of their own — see `logic/routingReasonCopy.ts` for the one place a
 * reason code becomes words.
 *
 * Behind `IDENTITY_ROUTER_V2`: `useIdentityAuthScreens()` is what a page asks
 * before rendering any of this, and the legacy screens answer until the flip.
 */
export { AuthShell } from "./components/AuthShell";
export { AuthValuePanel } from "./components/AuthValuePanel";
export { IdentifierFirstSignIn } from "./components/IdentifierFirstSignIn";
export { InviteLanding } from "./components/InviteLanding";
export { JoinBeforeCreateInterstitial } from "./components/JoinBeforeCreateInterstitial";
export { JoinInsteadNotice } from "./components/JoinInsteadNotice";
export { SignInMethodPicker } from "./components/SignInMethodPicker";
export { VerificationFirstSignUp } from "./components/VerificationFirstSignUp";
export { useIdentityAuthScreens } from "./hooks/useIdentityAuthScreens";
export type {
  JoinableOrganization,
  JoinBeforeCreateDecision,
  JoinBeforeCreateInput,
} from "./logic/joinBeforeCreate";
export { resolveJoinBeforeCreate } from "./logic/joinBeforeCreate";
export type { RoutingReasonCopy } from "./logic/routingReasonCopy";
export { signInRoutingReasonCopy } from "./logic/routingReasonCopy";
