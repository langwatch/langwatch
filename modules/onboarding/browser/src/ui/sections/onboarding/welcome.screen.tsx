/**
 * Welcome screen at /onboarding/welcome; design system shell stays in the route
 * layer.
 */

import { InvitationBeforeOnboarding } from "../../../ui/sections/invitation-before-onboarding.tsx";
import { WelcomeScreen } from "../../../ui/sections/welcome-screen.tsx";

const OnboardingWelcome: React.FC = () => (
  <InvitationBeforeOnboarding>
    <WelcomeScreen />
  </InvitationBeforeOnboarding>
);

export default OnboardingWelcome;
