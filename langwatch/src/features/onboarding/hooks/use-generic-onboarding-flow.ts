import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { OnboardingFlowDirection } from "../types/types";

export function useGenericOnboardingFlow<TScreenIndex extends number, TFlowConfig extends {
  visibleScreens: TScreenIndex[];
  first: TScreenIndex;
  last: TScreenIndex;
}>(
  flowConfig: TFlowConfig,
  canProceedFn: (currentScreen: TScreenIndex) => boolean,
  options?: {
    queryParamName?: string;
    screenIdMap?: { indexToId: Map<TScreenIndex, string>; idToIndex: Map<string, TScreenIndex> };
  }
) {
  const router = useRouter();
  const [currentScreenIndex, setCurrentScreenIndex] = useState<TScreenIndex>(flowConfig.first);
  const [direction, setDirection] = useState<OnboardingFlowDirection>(OnboardingFlowDirection.FORWARD);

  const useUrlSync = options?.screenIdMap !== undefined;
  const queryParamName = options?.queryParamName ?? "step";
  const screenIdMap = options?.screenIdMap;

  // Sync currentScreenIndex with URL query parameter (only if screenIdMap provided)
  useEffect(() => {
    if (!useUrlSync || !screenIdMap) return;

    const stepFromQuery = router.query[queryParamName];
    if (stepFromQuery && typeof stepFromQuery === "string") {
      const screenIndex = screenIdMap.idToIndex.get(stepFromQuery);
      if (screenIndex !== void 0 && flowConfig.visibleScreens.includes(screenIndex)) {
        setCurrentScreenIndex(screenIndex);
      }
    }
  }, [router.query, queryParamName, flowConfig.visibleScreens, screenIdMap, useUrlSync]);

  // Update URL when screen changes (only if screenIdMap provided)
  const updateUrlForScreen = (screenIndex: TScreenIndex) => {
    if (!useUrlSync || !screenIdMap) return;

    const screenId = screenIdMap.indexToId.get(screenIndex);
    if (!screenId) return;

    const currentQuery = { ...router.query };
    currentQuery[queryParamName] = screenId;
    void router.push(
      {
        pathname: router.pathname,
        query: currentQuery,
      },
      void 0,
      { shallow: true }
    );
  };

  const navigateTo = (newDirection: OnboardingFlowDirection) => {
    setDirection(newDirection);
    setCurrentScreenIndex((prev) => {
      const visible = flowConfig.visibleScreens;
      if (visible.length === 0) return prev;

      let currentPos = visible.indexOf(prev);
      if (currentPos === -1) {
        currentPos = Math.max(0, visible.indexOf(flowConfig.first));
      }

      let newPos = currentPos + newDirection;
      if (newPos < 0) newPos = 0;
      if (newPos > visible.length - 1) newPos = visible.length - 1;

      const newScreen = visible[newPos];
      if (newScreen === void 0) {
        console.error("Invalid screen index", newPos);
        return prev;
      }

      updateUrlForScreen(newScreen);
      return newScreen;
    });
  };

  const nextScreen = () => {
    const visible = flowConfig.visibleScreens;
    const pos = visible.indexOf(currentScreenIndex);
    if (pos === -1) {
      setDirection(OnboardingFlowDirection.FORWARD);
      const firstScreen = visible[Math.max(0, visible.indexOf(flowConfig.first))] ?? flowConfig.first;
      setCurrentScreenIndex(firstScreen);
      updateUrlForScreen(firstScreen);
      return;
    }
    if (pos < visible.length - 1) {
      navigateTo(OnboardingFlowDirection.FORWARD);
    }
  };

  const prevScreen = () => {
    const visible = flowConfig.visibleScreens;
    const pos = visible.indexOf(currentScreenIndex);
    if (pos === -1) {
      setDirection(OnboardingFlowDirection.BACKWARD);
      const firstScreen = visible[Math.max(0, visible.indexOf(flowConfig.first))] ?? flowConfig.first;
      setCurrentScreenIndex(firstScreen);
      updateUrlForScreen(firstScreen);
      return;
    }
    if (pos > 0) {
      navigateTo(OnboardingFlowDirection.BACKWARD);
    }
  };

  const skipScreen = () => {
    nextScreen();
  };

  const canProceed = () => {
    return canProceedFn(currentScreenIndex);
  };

  return {
    currentScreenIndex,
    direction,
    flow: flowConfig,
    navigation: {
      nextScreen,
      prevScreen,
      skipScreen,
      canProceed,
    },
    setCurrentScreenIndex: (index: TScreenIndex) => {
      setCurrentScreenIndex(index);
      updateUrlForScreen(index);
    },
  };
}
