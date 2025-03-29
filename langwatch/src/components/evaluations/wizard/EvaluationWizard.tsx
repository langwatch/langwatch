import {
  Box,
  Button,
  Card,
  Center,
  Heading,
  HStack,
  Spacer,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState, memo } from "react";
import { LuChevronRight } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { LogoIcon } from "../../icons/LogoIcon";
import { Dialog } from "../../ui/dialog";
import { Steps } from "../../ui/steps";
import {
  STEPS,
  useEvaluationWizardStore,
} from "~/components/evaluations/wizard/hooks/useEvaluationWizardStore";
import { TaskStep } from "./steps/TaskStep";
import { DatasetStep } from "./steps/DatasetStep";
import { ExecutionStep } from "./steps/ExecutionStep";
import { EvaluationStep } from "./steps/EvaluationStep";
import { useShallow } from "zustand/react/shallow";
import { WizardWorkspace } from "./WizardWorkspace";
import { ResultsStep } from "./steps/ResultsStep";
import { Tooltip } from "../../ui/tooltip";
import { useStepCompletedValue } from "./hooks/useStepCompletedValue";

export function EvaluationWizard({ isLoading }: { isLoading: boolean }) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const { isAutosaving } = useEvaluationWizardStore(
    useShallow((state) => {
      // For easier debugging
      if (typeof window !== "undefined") {
        // @ts-ignore
        window.state = state;
      }

      return {
        isAutosaving: state.isAutosaving,
      };
    })
  );

  return (
    <Dialog.Content width="full" height="full" minHeight="fit-content">
      <Dialog.CloseTrigger />
      <Dialog.Header
        background="white"
        paddingX={2}
        paddingY={3}
        borderBottom="1px solid"
        borderBottomColor="gray.200"
        display="flex"
      >
        <HStack width="full" justifyContent="start">
          <Box
            role="button"
            onClick={() => void router.push(`/${project?.slug}/evaluations_v2`)}
            cursor="pointer"
          >
            <LogoIcon width={24} height={24} />
          </Box>
          {isAutosaving && (
            <Tooltip content="Saving changes...">
              <Box>
                <Spinner size="sm" />
              </Box>
            </Tooltip>
          )}
        </HStack>
        <HStack width="full" justifyContent="center">
          <Heading as="h1" size="sm" fontWeight="normal">
            Evaluation Wizard
          </Heading>
        </HStack>
        <HStack width="full" justifyContent="end" paddingRight={10} />
      </Dialog.Header>
      <Dialog.Body
        display="flex"
        minHeight="fit-content"
        background="white"
        width="full"
        padding={0}
      >
        <WizardSidebar isLoading={isLoading} />
        <WizardWorkspace />
      </Dialog.Body>
    </Dialog.Content>
  );
}

const WizardSidebar = memo(function WizardSidebar({
  isLoading,
}: {
  isLoading: boolean;
}) {
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const { setWizardState, nextStep, step } = useEvaluationWizardStore(
    useShallow((state) => {
      return {
        setWizardState: state.setWizardState,
        nextStep: state.nextStep,
        step: state.wizardState.step,
      };
    })
  );

  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setShowSpinner(isLoading);
    }, isLoading ? 400 : 0);
  }, [isLoading]);

  useEffect(() => {
    let unmount: (() => void) | undefined = undefined;

    setTimeout(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsSticky(!!entry && entry.intersectionRatio < 1);
        },
        { threshold: [1] }
      );

      const current = stickyRef.current;
      if (current) {
        observer.observe(current);
      }

      unmount = () => {
        if (current) {
          observer.unobserve(current);
        }
      };
    }, 1000);

    return () => {
      unmount?.();
    };
  }, []);

  const stepCompletedValue = useStepCompletedValue();

  return (
    <VStack
      height={isLoading ? "full" : "fit-content"}
      minWidth="500px"
      width="full"
      maxWidth="500px"
      top={0}
      position="sticky"
    >
      {isLoading ? (
        <Center width="full" height="full">
          {showSpinner && <Spinner />}
        </Center>
      ) : (
        <>
          <VStack
            align="start"
            padding={6}
            gap={8}
            height="fit-content"
            width="full"
          >
            <Steps.Root
              size="sm"
              count={5}
              width="full"
              step={STEPS.indexOf(step)}
              onStepChange={(event) =>
                setWizardState({ step: STEPS[event.step] })
              }
            >
              <Steps.List>
                <Steps.Item
                  index={0}
                  title="Task"
                  isCompleted={!!stepCompletedValue("task")}
                />
                <Steps.Item
                  index={1}
                  title="Dataset"
                  isCompleted={!!stepCompletedValue("dataset")}
                />
                <Steps.Item
                  index={2}
                  title="Execution"
                  isCompleted={!!stepCompletedValue("execution")}
                />
                <Steps.Item
                  index={3}
                  title="Evaluation"
                  isCompleted={!!stepCompletedValue("evaluation")}
                />
                <Steps.Item
                  index={4}
                  title="Results"
                  isCompleted={!!stepCompletedValue("results")}
                />
              </Steps.List>
            </Steps.Root>
            {step === "task" && <TaskStep />}
            {step === "dataset" && <DatasetStep />}
            {step === "execution" && <ExecutionStep />}
            {step === "evaluation" && <EvaluationStep />}
            {step === "results" && <ResultsStep />}
          </VStack>
          <HStack
            ref={stickyRef}
            width="full"
            position="sticky"
            background="white"
            paddingX={6}
            paddingY={4}
            borderTop={isSticky ? "1px solid" : "none"}
            boxShadow={isSticky ? "-5px 0 10px 0 rgba(0, 0, 0, 0.1)" : "none"}
            transition="all 0.3s ease-in-out"
            borderTopColor="gray.200"
            bottom="-1px"
          >
            <Spacer />
            <Button variant="outline" onClick={() => nextStep()}>
              Next
              <LuChevronRight />
            </Button>
          </HStack>
        </>
      )}
    </VStack>
  );
});
