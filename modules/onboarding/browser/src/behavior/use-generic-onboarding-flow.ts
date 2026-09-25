import { useRouter } from "@langwatch/browser-host/use-router";
import { useEffect, useRef, useState } from "react";

import { OnboardingFlowDirection } from "./types.ts";

type ScreenIdMap<TScreenIndex extends number> = {
  indexToId: Map<TScreenIndex, string>;
  idToIndex: Map<string, TScreenIndex>;
};

function screenNamedByQuery<TScreenIndex extends number>({
  stepFromQuery,
  idToIndex,
  visibleScreens,
  first,
  current,
}: {
  stepFromQuery: unknown;
  idToIndex: Map<string, TScreenIndex>;
  visibleScreens: TScreenIndex[];
  first: TScreenIndex;
  current: TScreenIndex;
}): TScreenIndex {
  if (!stepFromQuery) return first;
  if (typeof stepFromQuery !== "string") return current;
  const screenIndex = idToIndex.get(stepFromQuery);
  if (screenIndex === void 0 || !visibleScreens.includes(screenIndex)) return current;
  return screenIndex;
}

function entryScreen<TScreenIndex extends number>({
  visible,
  first,
}: {
  visible: TScreenIndex[];
  first: TScreenIndex;
}): TScreenIndex {
  return visible[Math.max(0, visible.indexOf(first))] ?? first;
}

function steppedPosition<TScreenIndex extends number>({
  visible,
  from,
  first,
  direction,
}: {
  visible: TScreenIndex[];
  from: TScreenIndex;
  first: TScreenIndex;
  direction: OnboardingFlowDirection;
}): number {
  const fromPos = visible.indexOf(from);
  const currentPos = fromPos === -1 ? Math.max(0, visible.indexOf(first)) : fromPos;
  return Math.min(Math.max(currentPos + direction, 0), visible.length - 1);
}

function useScreenUrlSync<TScreenIndex extends number>({
  currentScreenIndex,
  setCurrentScreenIndex,
  flowConfig,
  useUrlSync,
  queryParamName,
  screenIdMap,
  firstScreenId,
}: {
  currentScreenIndex: TScreenIndex;
  setCurrentScreenIndex: (screen: TScreenIndex) => void;
  flowConfig: { visibleScreens: TScreenIndex[]; first: TScreenIndex };
  useUrlSync: boolean;
  queryParamName: string;
  screenIdMap: ScreenIdMap<TScreenIndex> | undefined;
  firstScreenId: string | undefined;
}): (screenIndex: TScreenIndex) => void {
  const router = useRouter();
  const isUpdatingUrl = useRef(false);

  // Sync currentScreenIndex with URL query parameter (only if screenIdMap provided)
  useEffect(() => {
    if (!useUrlSync || !screenIdMap) return;
    if (isUpdatingUrl.current) return;

    const queriedScreen = screenNamedByQuery({
      stepFromQuery: router.query[queryParamName],
      idToIndex: screenIdMap.idToIndex,
      visibleScreens: flowConfig.visibleScreens,
      first: flowConfig.first,
      current: currentScreenIndex,
    });
    if (queriedScreen !== currentScreenIndex) {
      setCurrentScreenIndex(queriedScreen);
    }
  }, [
    router.query,
    queryParamName,
    flowConfig.visibleScreens,
    flowConfig.first,
    screenIdMap,
    useUrlSync,
    currentScreenIndex,
    setCurrentScreenIndex,
  ]);

  // Update URL when screen changes (only if screenIdMap provided)
  const updateUrlForScreen = (screenIndex: TScreenIndex) => {
    if (!useUrlSync || !screenIdMap) return;

    const screenId = screenIdMap.indexToId.get(screenIndex);
    if (!screenId) return;

    isUpdatingUrl.current = true;

    const currentQuery = { ...router.query };

    // If this is the first screen, remove the step param entirely
    if (screenId === firstScreenId) {
      delete currentQuery[queryParamName];
    } else {
      currentQuery[queryParamName] = screenId;
    }

    void router
      .push(
        {
          pathname: router.pathname,
          query: currentQuery,
        },
        void 0,
        { shallow: true },
      )
      .then(() => {
        // Clear the flag after navigation completes
        setTimeout(() => {
          isUpdatingUrl.current = false;
        }, 100);
      });
  };

  return updateUrlForScreen;
}

export function useGenericOnboardingFlow<
  TScreenIndex extends number,
  TFlowConfig extends {
    visibleScreens: TScreenIndex[];
    first: TScreenIndex;
    last: TScreenIndex;
  },
>(
  flowConfig: TFlowConfig,
  canProceedFn: (currentScreen: TScreenIndex) => boolean,
  options?: {
    queryParamName?: string;
    screenIdMap?: ScreenIdMap<TScreenIndex>;
    firstScreenId?: string;
  },
) {
  const [currentScreenIndex, setCurrentScreenIndex] = useState<TScreenIndex>(flowConfig.first);
  const [direction, setDirection] = useState<OnboardingFlowDirection>(
    OnboardingFlowDirection.FORWARD,
  );

  const useUrlSync = options?.screenIdMap !== undefined;
  const queryParamName = options?.queryParamName ?? "step";
  const screenIdMap = options?.screenIdMap;
  const firstScreenId = options?.firstScreenId;

  const updateUrlForScreen = useScreenUrlSync({
    currentScreenIndex,
    setCurrentScreenIndex,
    flowConfig,
    useUrlSync,
    queryParamName,
    screenIdMap,
    firstScreenId,
  });

  const navigateTo = (newDirection: OnboardingFlowDirection) => {
    setDirection(newDirection);
    setCurrentScreenIndex((prev) => {
      const visible = flowConfig.visibleScreens;
      if (visible.length === 0) return prev;

      const newPos = steppedPosition({
        visible,
        from: prev,
        first: flowConfig.first,
        direction: newDirection,
      });

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
      const firstScreen = entryScreen({ visible, first: flowConfig.first });
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
      const firstScreen = entryScreen({ visible, first: flowConfig.first });
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

  const canGoBack = () => {
    const visible = flowConfig.visibleScreens;
    const pos = visible.indexOf(currentScreenIndex);
    return pos > 0;
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
    canGoBack: canGoBack(),
    setCurrentScreenIndex: (index: TScreenIndex) => {
      setCurrentScreenIndex(index);
      updateUrlForScreen(index);
    },
  };
}
