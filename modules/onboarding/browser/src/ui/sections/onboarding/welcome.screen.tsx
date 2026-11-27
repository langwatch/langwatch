/**
 * Welcome screen at /onboarding/welcome; design system shell stays in the route
 * layer. A held membership outranks onboarding (modules/organization/specs/seat-requests.feature).
 */

import { useLent } from "@langwatch/browser-host/lent";
import { HeldMembershipGateToken } from "@langwatch/organization-client";
import { Suspense } from "react";

import { LoadingScreen } from "../../../ui/blocks/loading-screen.tsx";
import { InvitationBeforeOnboarding } from "../../../ui/sections/invitation-before-onboarding.tsx";
import { WelcomeScreen } from "../../../ui/sections/welcome-screen.tsx";

const OnboardingWelcome: React.FC = () => {
  const HeldMembershipGate = useLent(HeldMembershipGateToken);
  return (
    <InvitationBeforeOnboarding>
      {HeldMembershipGate ? (
        <Suspense fallback={<LoadingScreen />}>
          <HeldMembershipGate>
            <WelcomeScreen />
          </HeldMembershipGate>
        </Suspense>
      ) : (
        <WelcomeScreen />
      )}
    </InvitationBeforeOnboarding>
  );
};

export default OnboardingWelcome;
