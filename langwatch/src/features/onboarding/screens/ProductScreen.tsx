import React, { useEffect, useMemo, useState } from "react";
import { OnboardingContainer } from "../components/containers/OnboardingContainer";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { useProductFlow } from "../hooks/use-product-flow";
import { useCreateProductScreens } from "./create-product-screens";
import { OnboardingMeshBackground } from "../components/OnboardingMeshBackground";
import { Box } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export const ProductScreen: React.FC = () => {
  const {
    currentScreenIndex,
    flow,
    handleSelectProduct,
  } = useProductFlow();

  const { organization, isLoading } = useOrganizationTeamProject({
    redirectToOnboarding: true,
  });

  // Delay showing skeleton to avoid flicker on fast loads
  const [delayedLoading, setDelayedLoading] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isLoading) {
      timer = setTimeout(() => setDelayedLoading(true), 200);
    } else {
      setDelayedLoading(false);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoading]);

  const screens = useCreateProductScreens({ flow, onSelectProduct: handleSelectProduct });

  const currentVisibleIndex = useMemo(
    () => flow.visibleScreens.findIndex((s: number) => s === currentScreenIndex),
    [flow.visibleScreens, currentScreenIndex]
  );
  const currentScreen = currentVisibleIndex >= 0 ? screens[currentVisibleIndex] : undefined;
  if (!currentScreen) {
    return null;
  }

  return (
    <AnalyticsBoundary name="onboarding_product" sendViewedEvent>
      <OnboardingContainer
        title={currentScreen.heading}
        subTitle={currentScreen.subHeading}
        loading={delayedLoading}
        compressedHeader
      >
        <Box w="full" minH="100dvh" position="relative">
          <OnboardingMeshBackground opacity={0.22} blurPx={96} />
          {!isLoading && currentScreen.component ? <currentScreen.component /> : null}
        </Box>
      </OnboardingContainer>
    </AnalyticsBoundary>
  );
};
export default ProductScreen;
