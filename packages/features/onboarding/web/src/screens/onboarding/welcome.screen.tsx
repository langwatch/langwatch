/**
 * `/onboarding/welcome`.
 *
 * The platform page wrapped this in `UiDesignSystemShell` with the
 * application's composed Chakra system. That wrapper is `@langwatch/ui`'s, and a
 * feature package may not import the application it is mounted by, so the shell
 * stays where it belongs — around the route, in `apps/ui/src/features/onboarding`
 * — and the screen is a screen.
 */

import { WelcomeScreen } from "../../ui/sections/welcome-screen";

const OnboardingWelcome: React.FC = () => <WelcomeScreen />;

export default OnboardingWelcome;
