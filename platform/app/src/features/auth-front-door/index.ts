/**
 * The first-party front door: every screen a signed-out person can reach
 * (D13, ADR-117). The screens render routing decisions and contain no routing
 * logic of their own — see `logic/routingReasonCopy.ts` for the one place a
 * reason code becomes words.
 *
 * Behind `IDENTITY_ROUTER_V2`: `useIdentityFrontDoor()` is what a page asks
 * before rendering any of this, and the legacy screens answer until the flip.
 */
export { FrontDoorShell } from "./components/FrontDoorShell";
export { FrontDoorTraceDemo } from "./components/FrontDoorTraceDemo";
export { FrontDoorValuePanel } from "./components/FrontDoorValuePanel";
export { IdentifierFirstSignIn } from "./components/IdentifierFirstSignIn";
export { InviteLanding } from "./components/InviteLanding";
export { JoinBeforeCreateInterstitial } from "./components/JoinBeforeCreateInterstitial";
export { SignInMethodPicker } from "./components/SignInMethodPicker";
export { VerificationFirstSignUp } from "./components/VerificationFirstSignUp";
export { useIdentityFrontDoor } from "./hooks/useIdentityFrontDoor";
export type {
  JoinableOrganization,
  JoinBeforeCreateDecision,
  JoinBeforeCreateInput,
} from "./logic/joinBeforeCreate";
export { resolveJoinBeforeCreate } from "./logic/joinBeforeCreate";
export type { RoutingReasonCopy } from "./logic/routingReasonCopy";
export { signInRoutingReasonCopy } from "./logic/routingReasonCopy";
