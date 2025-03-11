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

export function EvaluationWizard() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const { wizardState, setWizardState, nextStep } = useEvaluationWizardStore();
  const { step } = wizardState;

  useEffect(() => {
    let unmount: (() => void) | undefined = undefined;

    setTimeout(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          console.log(entry?.intersectionRatio);
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
        <VStack height="fit-content" background="white">
          <VStack
            align="start"
            minWidth="460px"
            maxWidth="580px"
            padding={6}
            gap={8}
            height="fit-content"
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
        <VStack
          background="url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjRjJGNEY4Ii8+CjxyZWN0IHg9IjE0IiB5PSIxNCIgd2lkdGg9IjIiIGhlaWdodD0iMiIgZmlsbD0iI0U1RTdFQiIvPgo8L3N2Zz4K)"
          padding={6}
          width="full"
          height="100%"
          minHeight="calc(100vh - 50px)"
          borderLeft="1px solid"
          borderLeftColor="gray.200"
        >
          {wizardState.datasetId && (
            <Card.Root width="full" position="sticky" top={6}>
              <Card.Body width="full" paddingBottom={6}>
                <Box width="full" position="relative">
                  <DatasetTable
                    datasetId={wizardState.datasetId}
                    insideWizard
                  />
                </Box>
              </Card.Body>
            </Card.Root>
          )}
        </VStack>
      </Dialog.Body>
    </Dialog.Content>
  );
}
