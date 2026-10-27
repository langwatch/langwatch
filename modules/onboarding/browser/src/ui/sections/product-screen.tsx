import { PROJECT_READ_PERMISSIONS, useMintPersonalToken } from "@langwatch/api-key-client";
import { Box } from "@langwatch/design-system/primitives";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";

import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useProductFlow } from "../../behavior/use-product-flow.ts";
import { useProjectBySlugOrLatest } from "../../behavior/use-project-by-slug-or-latest.ts";
import { useOnboardingHost } from "../../model/onboarding-host.ts";
import { LoadingScreen } from "../blocks/loading-screen.tsx";
import { OnboardingContainer } from "../blocks/onboarding-container.tsx";
import { ScreenLifecycle } from "../elements/screen-lifecycle.tsx";
import { ActiveProjectProvider } from "./active-project-context.tsx";
import { useCreateProductScreens } from "./create-product-screens.tsx";

const PRODUCT_BOUNDARY = "onboarding_product";

export const ProductScreen: React.FC = () => {
  const { currentScreenIndex, flow, navigation, canGoBack, handleSelectProduct } = useProductFlow();
  const { organization, isLoading } = useOrganizationTeamProject({
    redirectToOnboarding: true,
  });
  const { project: resolvedProject, slug: skipSlug } = useProjectBySlugOrLatest(organization);
  const host = useOnboardingHost();

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

  const screens = useCreateProductScreens({
    flow,
    onSelectProduct: handleSelectProduct,
    onContinue: navigation.nextScreen,
  });

  const currentVisibleIndex = useMemo(
    () => flow.visibleScreens.findIndex((s) => Number(s) === Number(currentScreenIndex)),
    [flow.visibleScreens, currentScreenIndex],
  );
  const currentScreen = currentVisibleIndex >= 0 ? screens[currentVisibleIndex] : void 0;
  const tokenScope = {
    organizationId: organization?.id,
    projectId: resolvedProject?.id,
    userId: host.currentUser()?.id,
  };
  // Two tokens, each minted only on its own click: ingestion for `.env`, project reads for MCP.
  const minting = useMintPersonalToken({ ...tokenScope, name: "Personal access token" });
  const mcpMinting = useMintPersonalToken({
    ...tokenScope,
    name: "MCP access token",
    permissions: PROJECT_READ_PERMISSIONS,
  });
  if (!currentScreen) {
    return null;
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <ScreenLifecycle boundary={PRODUCT_BOUNDARY} />
      <OnboardingContainer
        boundary={PRODUCT_BOUNDARY}
        title={currentScreen.heading}
        subTitle={currentScreen.subHeading}
        loading={delayedLoading}
        widthVariant={currentScreen.widthVariant ?? "narrow"}
        showBackButton={canGoBack}
        onBack={() => navigation.prevScreen()}
        skipHref={skipSlug ? `/${skipSlug}` : undefined}
      >
        <Box w="full">
          <ActiveProjectProvider
            value={{
              project: resolvedProject,
              organization,
              freshToken: minting.token,
              minting,
              mcpMinting,
            }}
          >
            {!isLoading && currentScreen.component ? (
              <>
                <ScreenLifecycle key={currentScreen.id} boundary={currentScreen.id} />
                {/*
                 * Kept ambient: screens such as `ViaClaudeCodeScreen` read the project and
                 * both mints from ActiveProjectContext, not from a `surface` prop.
                 */}
                <AnalyticsBoundary name={currentScreen.id}>
                  <currentScreen.component surface={{ boundary: currentScreen.id }} />
                </AnalyticsBoundary>
              </>
            ) : null}
          </ActiveProjectProvider>
        </Box>
      </OnboardingContainer>
    </>
  );
};
export default ProductScreen;
