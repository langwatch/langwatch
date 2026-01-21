export type TourStep = {
  id: string;
  targetId: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right";
};

export type StoredTourState = {
  hasSeenTour: boolean;
  completedAt: string | null;
};

export interface HomeTourContextValue {
  // State
  isActive: boolean;
  currentStep: number;
  totalSteps: number;

  // Methods
  startTour: () => void;
  nextStep: () => void;
  skipTour: () => void;
  completeTour: () => void;

  // Computed
  isFirstStep: boolean;
  isLastStep: boolean;
  currentStepData: TourStep | null;
}
