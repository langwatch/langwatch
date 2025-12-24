import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import type {
  HomeTourContextValue,
  StoredTourState,
  TourStep,
} from "./types";
import { tourSteps } from "./tourSteps";

const TOUR_STORAGE_KEY = "langwatch_home_tour_state";

const HomeTourContext = createContext<HomeTourContextValue | undefined>(
  undefined
);

export function useHomeTour() {
  const context = useContext(HomeTourContext);
  // Return undefined if used outside provider (e.g., on non-home pages)
  // This allows SupportMenu to conditionally render the tour button
  return context;
}

function getStoredTourState(): StoredTourState {
  if (typeof window === "undefined") return getDefaultTourState();

  try {
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Failed to parse tour state from localStorage:", error);
  }
  return getDefaultTourState();
}

function getDefaultTourState(): StoredTourState {
  return {
    hasSeenTour: false,
    completedAt: null,
  };
}

function saveTourState(state: StoredTourState) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save tour state to localStorage:", error);
  }
}

export function HomeTourProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasSeenTour, setHasSeenTour] = useState(true); // Default to true to prevent flash

  useEffect(() => {
    const storedState = getStoredTourState();
    setHasSeenTour(storedState.hasSeenTour);

    if (!storedState.hasSeenTour) {
      const timer = setTimeout(() => {
        setIsActive(true);
        setCurrentStep(0);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const startTour = useCallback(() => {
    setIsActive(true);
    setCurrentStep(0);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep]);

  const skipTour = useCallback(() => {
    setIsActive(false);
    setHasSeenTour(true);
    saveTourState({
      hasSeenTour: true,
      completedAt: null,
    });
  }, []);

  const completeTour = useCallback(() => {
    setIsActive(false);
    setHasSeenTour(true);
    saveTourState({
      hasSeenTour: true,
      completedAt: new Date().toISOString(),
    });
  }, []);

  const currentStepData: TourStep | null =
    currentStep < tourSteps.length ? tourSteps[currentStep] : null;

  const value: HomeTourContextValue = {
    isActive,
    currentStep,
    totalSteps: tourSteps.length,
    startTour,
    nextStep,
    skipTour,
    completeTour,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === tourSteps.length - 1,
    currentStepData,
  };

  return (
    <HomeTourContext.Provider value={value}>
      {children}
    </HomeTourContext.Provider>
  );
}
