import {
  Box,
  Button,
  Flex,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { HeroBand } from "./HeroBand";
import { StepDots } from "./StepDots";
import { STEPS } from "./steps";

interface WelcomeDialogProps {
  onSkip: (args: { remember: boolean }) => void;
  onFinish: () => void;
}

export const WelcomeDialog: React.FC<WelcomeDialogProps> = ({
  onSkip,
  onFinish,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [answered, setAnswered] = useState<Set<number>>(() => new Set());
  const directionRef = useRef<1 | -1>(1);
  const reducedMotion = useReducedMotion();

  const isLastStep = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex]!;
  const StepContent = step.content;
  const blocked = !!step.requiresAnswer && !answered.has(stepIndex);

  const markAnswered = useCallback(() => {
    setAnswered((prev) => {
      if (prev.has(stepIndex)) return prev;
      const next = new Set(prev);
      next.add(stepIndex);
      return next;
    });
  }, [stepIndex]);

  const goNext = useCallback(() => {
    directionRef.current = 1;
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  }, []);

  const goBack = useCallback(() => {
    directionRef.current = -1;
    setStepIndex((s) => Math.max(s - 1, 0));
  }, []);

  const isFirstStep = stepIndex === 0;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "BUTTON") return;
      if (blocked) return;
      e.preventDefault();
      if (isLastStep) onFinish();
      else goNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isLastStep, onFinish, goNext, blocked]);

  return (
    <VStack gap={6} width="full" align="stretch">
      {/* HeroBand stays mounted across step changes — its WebGL shader
          backdrop runs an ongoing animation we don't want to restart. The
          title/subtitle crossfade lives inside HeroBand. Only the step
          body slides on step changes. */}
      <HeroBand title={step.title} subtitle={step.subtitle} />
      <Box position="relative" overflow="hidden" paddingX={2}>
        <AnimatePresence
          mode="popLayout"
          initial={false}
          custom={directionRef.current}
        >
          <motion.div
            key={stepIndex}
            custom={directionRef.current}
            initial="enter"
            animate="center"
            exit="exit"
            variants={{
              enter: (dir: number) => ({
                opacity: 0,
                x: reducedMotion ? 0 : dir * 30,
                filter: reducedMotion ? "none" : "blur(3px)",
              }),
              center: {
                opacity: 1,
                x: 0,
                filter: "blur(0px)",
              },
              exit: (dir: number) => ({
                opacity: 0,
                x: reducedMotion ? 0 : dir * -30,
                filter: reducedMotion ? "none" : "blur(3px)",
                position: "absolute" as const,
                top: 0,
                left: 0,
                right: 0,
              }),
            }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            style={{ width: "100%" }}
          >
            <StepContent markAnswered={markAnswered} />
          </motion.div>
        </AnimatePresence>
      </Box>

      <Flex
        align="center"
        justify="space-between"
        gap={4}
        paddingTop={2}
        paddingX={2}
      >
        <HStack gap={4} align="center">
          <StepDots current={stepIndex} total={STEPS.length} />
          <Checkbox
            size="sm"
            checked={dontShowAgain}
            onCheckedChange={(e) => setDontShowAgain(!!e.checked)}
          >
            <Text textStyle="xs" color="fg.muted">
              Don&apos;t show again
            </Text>
          </Checkbox>
        </HStack>
        <HStack gap={2}>
          <Button
            size="sm"
            variant="ghost"
            color="fg.muted"
            onClick={goBack}
            disabled={isFirstStep}
            aria-label="Previous step"
          >
            <Icon boxSize={3.5}>
              <ArrowLeft />
            </Icon>
            Back
          </Button>
          {isLastStep ? (
            <Button
              size="sm"
              colorPalette="blue"
              onClick={onFinish}
              disabled={blocked}
              title={blocked ? "Pick an option to continue" : undefined}
            >
              Dive in
              <Icon boxSize={3.5}>
                <ArrowRight />
              </Icon>
            </Button>
          ) : (
            <Button
              size="sm"
              colorPalette="blue"
              onClick={goNext}
              disabled={blocked}
              title={blocked ? "Pick an option to continue" : undefined}
            >
              Next
              <Icon boxSize={3.5}>
                <ArrowRight />
              </Icon>
            </Button>
          )}
        </HStack>
      </Flex>
    </VStack>
  );
};
