import { useEffect, useState, useRef } from "react";
import { Box, Portal } from "@chakra-ui/react";
import { useHomeTour } from "./HomeTourContext";
import { CoachMark } from "./CoachMark";

const COACH_MARK_WIDTH = 320;
const OFFSET = 16; // Gap between coach mark and target

export function HomeTourOverlay() {
  const {
    isActive,
    currentStep,
    totalSteps,
    isLastStep,
    currentStepData,
    nextStep,
    skipTour,
    completeTour,
  } = useHomeTour();

  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const currentTargetRef = useRef<Element | null>(null);

  useEffect(() => {
    const cleanupHighlight = () => {
      if (currentTargetRef.current) {
        const el = currentTargetRef.current as HTMLElement;
        el.style.position = "";
        el.style.zIndex = "";
        el.style.isolation = "";
        el.style.background = "";
        el.style.borderRadius = "";
        el.style.padding = "";
      }
    };

    cleanupHighlight();

    if (!isActive || !currentStepData) {
      setIsVisible(false);
      currentTargetRef.current = null;
      return;
    }

    const targetElement = document.querySelector(
      `[data-tour-target="${currentStepData.targetId}"]`
    );

    if (!targetElement) {
      setTimeout(() => nextStep(), 100);
      return;
    }

    currentTargetRef.current = targetElement;

    const el = targetElement as HTMLElement;
    el.style.position = "relative";
    el.style.zIndex = "1401";
    el.style.isolation = "isolate";

    if (currentStepData.targetId !== "main-menu") {
      el.style.background = "white";
      el.style.borderRadius = "12px";
      el.style.padding = "16px";
    }

    const calculatePosition = () => {
      const rect = targetElement.getBoundingClientRect();
      let top = 0;
      let left = 0;

      switch (currentStepData.placement) {
        case "right":
          top = rect.top + rect.height / 2 - 100;
          left = rect.right + OFFSET;
          break;
        case "top":
          top = rect.top - 180 - OFFSET;
          left = rect.left + rect.width / 2 - COACH_MARK_WIDTH / 2;
          break;
        case "bottom":
          top = rect.bottom + OFFSET;
          left = rect.left + rect.width / 2 - COACH_MARK_WIDTH / 2;
          break;
        case "left":
          top = rect.top + rect.height / 2 - 100;
          left = rect.left - COACH_MARK_WIDTH - OFFSET;
          break;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < OFFSET) left = OFFSET;
      if (left + COACH_MARK_WIDTH > viewportWidth - OFFSET) {
        left = viewportWidth - COACH_MARK_WIDTH - OFFSET;
      }
      if (top < OFFSET) top = OFFSET;
      if (top > viewportHeight - OFFSET) {
        top = viewportHeight - 200 - OFFSET;
      }

      setPosition({ top, left });
      setIsVisible(true);
    };

    calculatePosition();
    window.addEventListener("scroll", calculatePosition, true);
    window.addEventListener("resize", calculatePosition);

    return () => {
      window.removeEventListener("scroll", calculatePosition, true);
      window.removeEventListener("resize", calculatePosition);
      cleanupHighlight();
    };
  }, [isActive, currentStepData, currentStep, nextStep]);

  if (!isActive || !currentStepData || !isVisible) {
    return null;
  }

  return (
    <>
      <Portal>
        <Box
          position="fixed"
          top={0}
          left={0}
          right={0}
          bottom={0}
          background="rgba(15, 23, 42, 0.45)"
          backdropFilter="blur(4px)"
          zIndex={1399}
          onClick={skipTour}
        />
      </Portal>

      <CoachMark
        step={currentStepData}
        currentStepNumber={currentStep}
        totalSteps={totalSteps}
        isLastStep={isLastStep}
        onNext={isLastStep ? completeTour : nextStep}
        onSkip={skipTour}
        position={position}
      />
    </>
  );
}
