import {
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { LuChevronRight } from "react-icons/lu";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { LogoIcon } from "../../icons/LogoIcon";
import { Dialog } from "../../ui/dialog";
import { Steps } from "../../ui/steps";
import {
  STEPS,
  useEvaluationWizardStore,
} from "~/hooks/useEvaluationWizardStore";
import { TaskStep } from "./steps/TaskStep";
import { DatasetStep } from "./steps/DatasetStep";
import { ExecutionStep } from "./steps/ExecutionStep";
import { EvaluationStep } from "./steps/EvaluationStep";
import { useShallow } from "zustand/react/shallow";
import { WizardWorkspace } from "./WizardWorkspace";
import { ResultsStep, useStepCompletedValue } from "./steps/ResultsStep";

export function EvaluationWizard() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const { wizardState, setWizardState, nextStep } = useEvaluationWizardStore(
    useShallow((state) => {
      if (typeof window !== "undefined") {
        // @ts-ignore
        window.state = state;
      }
      return state;
    })
  );
  const { step } = wizardState;

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
        <HStack width="full">
          <Box
            role="button"
            onClick={() => void router.push(`/${project?.slug}/evaluations_v2`)}
            cursor="pointer"
          >
            <LogoIcon width={24} height={24} />
          </Box>
        </HStack>
        <HStack width="full">
          <Heading as="h1" size="sm" fontWeight="normal">
            Evaluation Wizard
          </Heading>
        </HStack>
        <Spacer width="full" />
      </Dialog.Header>
      <Dialog.Body display="flex" height="fit-content" width="full" padding={0}>
        <VStack
          height="fit-content"
          background="white"
          minWidth="500px"
          width="full"
          maxWidth="500px"
        >
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
        </VStack>
        <WizardWorkspace />
      </Dialog.Body>
    </Dialog.Content>
  );
}
