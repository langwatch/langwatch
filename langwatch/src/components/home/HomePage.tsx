import { Container, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "../DashboardLayout";
import { LearningResources } from "./LearningResources";
import { OnboardingProgress } from "./OnboardingProgress";
import { QuickAccessLinks } from "./QuickAccessLinks";
import { RecentItemsSection } from "./RecentItemsSection";
import { TracesOverview } from "./TracesOverview";
import { WelcomeHeader } from "./WelcomeHeader";
import { HomeTourProvider } from "./coachmarks/HomeTourContext";
import { HomeTourOverlay } from "./coachmarks/HomeTourOverlay";

export function HomePage() {
  return (
    <HomeTourProvider>
      <DashboardLayout>
        <Container maxW="5xl" padding={6}>
          <VStack gap={6} width="full" align="start">
            <WelcomeHeader />
            <OnboardingProgress />
            <TracesOverview />
            <RecentItemsSection />
            <QuickAccessLinks />
            <LearningResources />
          </VStack>
        </Container>
      </DashboardLayout>
      <HomeTourOverlay />
    </HomeTourProvider>
  );
}
