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
  steps,
  useEvaluationWizardStore,
} from "~/hooks/useEvaluationWizardStore";
import { TaskSelection } from "./steps/TaskSelection";
import { DatasetSelection } from "./steps/DatasetSelection";
import { DatasetTable } from "../../datasets/DatasetTable";
import { ExecutorSelection } from "./steps/ExecutorSelection";
import { EvaluationSelection } from "./steps/EvaluationSelection";
import { useShallow } from "zustand/react/shallow";
import { WizardWorkspace } from "./WizardWorkspace";

export function EvaluationWizard() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const { wizardState, setWizardState, nextStep, getDatasetId } =
    useEvaluationWizardStore(
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
              step={steps.indexOf(step)}
              onStepChange={(event) =>
                setWizardState({ step: steps[event.step] })
              }
            >
              <Steps.List>
                <Steps.Item index={0} title="Task" />
                <Steps.Item index={1} title="Dataset" />
                <Steps.Item index={2} title="Executor" />
                <Steps.Item index={3} title="Evaluator" />
                <Steps.Item index={4} title="Results" />
              </Steps.List>
            </Steps.Root>
            {step === "task" && <TaskSelection />}
            {step === "dataset" && <DatasetSelection />}
            {step === "executor" && <ExecutorSelection />}
            {step === "evaluator" && <EvaluationSelection />}
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
