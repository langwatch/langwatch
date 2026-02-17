import { Container, VStack } from "@chakra-ui/react";
import { DashboardLayout } from "../DashboardLayout";
import { LearningResources } from "./LearningResources";
import { OnboardingProgress } from "./OnboardingProgress";
import { QuickAccessLinks } from "./QuickAccessLinks";
import { RecentItemsSection } from "./RecentItemsSection";
import { SdkRadarCard } from "./SdkRadarCard";
import { TracesOverview } from "./TracesOverview";
import { WelcomeHeader } from "./WelcomeHeader";

export function HomePage() {
  return (
    <DashboardLayout>
      <Container maxW="5xl" padding={6}>
        <VStack gap={6} width="full" align="start">
          <WelcomeHeader />
          <SdkRadarCard />
          <OnboardingProgress />
          <TracesOverview />
          <RecentItemsSection />
          <QuickAccessLinks />
          <LearningResources />
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
