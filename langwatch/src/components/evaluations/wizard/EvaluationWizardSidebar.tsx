import {
  Button,
  Center,
  HStack,
  Spacer,
  Spinner,
  VStack,
} from "@chakra-ui/react";
import { useReactFlow } from "@xyflow/react";
import { useRouter } from "next/router";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  LuActivity,
  LuChevronLeft,
  LuChevronRight,
  LuCode,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import {
  STEPS,
  useEvaluationWizardStore,
} from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { Steps } from "../../ui/steps";
import { toaster } from "../../ui/toaster";
import { Tooltip } from "../../ui/tooltip";
import { RunEvaluationButton } from "./components/RunTrialEvaluationButton";
import { useStepCompletedValue } from "./hooks/useStepCompletedValue";
import { DatasetStep } from "./steps/DatasetStep";
import { EvaluationStep } from "./steps/EvaluationStep";
import { ExecutionStep } from "./steps/ExecutionStep";
import { ResultsStep } from "./steps/ResultsStep";
import { TaskStep } from "./steps/TaskStep";

export const WizardSidebar = memo(function WizardSidebar({
  isLoading,
}: {
  isLoading: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  const isTallScreen =
    typeof window !== "undefined" && window.innerHeight > 900;
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);
  const {
    setWizardState,
    nextStep,
    step,
    previousStep,
    task,
    executionMethod,
    isAutosaving,
    experimentId,
    evaluatorNode,
    entryNodeDatasetId,
  } = useEvaluationWizardStore(
    useShallow((state) => {
      return {
        setWizardState: state.setWizardState,
        nextStep: state.nextStep,
        step: state.wizardState.step,
        previousStep: state.previousStep,
        task: state.wizardState.task,
        executionMethod: state.wizardState.executionMethod,
        isAutosaving: state.isAutosaving,
        experimentId: state.experimentId,
        evaluatorNode: state.getFirstEvaluatorNode(),
        entryNodeDatasetId: state.entryNodeDatasetId,
      };
    })
  );

  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    setTimeout(
      () => {
        setShowSpinner(isLoading);
      },
      isLoading ? 400 : 0
    );
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

      const body = document.getElementsByTagName("body")[0];
      if (body) {
        // Workaround for fixing the scroll getting locked for some reason when moving back to evaluations list page
        body.style.overflow = "auto";
      }
    };
  }, []);

  const stepCompletedValue = useStepCompletedValue();
  const enableMonitoringDisabled =
    !stepCompletedValue("task") ||
    !stepCompletedValue("execution") ||
    !stepCompletedValue("evaluation") ||
    isAutosaving ||
    !experimentId ||
    !project;
  const saveAsMonitor = api.experiments.saveAsMonitor.useMutation();
  const router = useRouter();
  const reactFlow = useReactFlow();

  const canProceed = useMemo(() => {
    if (step === "task") {
      return !!task;
    }

    if (step === "dataset") {
      return !!entryNodeDatasetId;
    }

    if (step === "execution") {
      return !!executionMethod;
    }

    if (step === "evaluation") {
      return !!evaluatorNode;
    }

    return true;
  }, [step, task, entryNodeDatasetId, executionMethod, evaluatorNode]);

  // When state changes, update the view to show the tab user
  // should be paying attention to at the moment
  useEffect(() => {
    if (step === "execution" && executionMethod) {
      setWizardState({ workspaceTab: "workflow" });
      setTimeout(() => {
        reactFlow.fitView({
          maxZoom: 1.2,
        });
      }, 100);
    }
    if (step === "evaluation" && evaluatorNode) {
      setWizardState({ workspaceTab: "workflow" });
      setTimeout(() => {
        reactFlow.fitView({
          maxZoom: 1.2,
        });
      }, 100);
    }
    if (step === "dataset") {
      setWizardState({ workspaceTab: "dataset" });
    }
    if (step === "results") {
      setWizardState({ workspaceTab: "results" });
    }
  }, [step, setWizardState, executionMethod, evaluatorNode?.data?.evaluator]);

  return (
    <VStack
      height={isLoading || !isTallScreen ? "full" : "fit-content"}
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
            height={isTallScreen ? "fit-content" : "full"}
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
                  isDisabled={!stepCompletedValue("task")}
                />
                <Steps.Item
                  index={2}
                  title="Execution"
                  isCompleted={!!stepCompletedValue("execution")}
                  isDisabled={!stepCompletedValue("dataset")}
                />
                <Steps.Item
                  index={3}
                  title="Evaluation"
                  isCompleted={!!stepCompletedValue("evaluation")}
                  isDisabled={!stepCompletedValue("execution")}
                />
                <Steps.Item
                  index={4}
                  title="Results"
                  isCompleted={!!stepCompletedValue("results")}
                  isDisabled={!stepCompletedValue("evaluation")}
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
            {step !== "task" && (
              <Button
                variant="ghost"
                onClick={() => previousStep()}
                marginLeft={-2}
              >
                <LuChevronLeft />
                Back
              </Button>
            )}
            <Spacer />
            {step !== "results" && (
              <Button
                id="js-next-step-button"
                variant="outline"
                onClick={() => nextStep()}
                disabled={!canProceed}
              >
                Next
                <LuChevronRight />
              </Button>
            )}
            {step === "results" &&
              task === "real_time" &&
              executionMethod === "realtime_on_message" && (
                <Tooltip
                  content={
                    enableMonitoringDisabled
                      ? "Complete all the steps to enable monitoring"
                      : ""
                  }
                  positioning={{
                    placement: "top",
                  }}
                >
                  <Button
                    colorPalette="green"
                    disabled={enableMonitoringDisabled}
                    loading={saveAsMonitor.isLoading}
                    onClick={() => {
                      if (enableMonitoringDisabled) {
                        return;
                      }

                      saveAsMonitor.mutate(
                        {
                          projectId: project.id,
                          experimentId: experimentId,
                        },
                        {
                          onSuccess: () => {
                            void router.push(`/${project.slug}/evaluations`);

                            toaster.create({
                              title: "Monitor saved successfully",
                              description:
                                "Incoming messages will now be evaluated",
                              type: "success",
                              placement: "top-end",
                              meta: {
                                closable: true,
                              },
                            });
                          },
                          onError: () => {
                            toaster.create({
                              title: "Error creating monitor",
                              description: "Please try again",
                              type: "error",
                              placement: "top-end",
                              meta: {
                                closable: true,
                              },
                            });
                          },
                        }
                      );
                    }}
                  >
                    <LuActivity />
                    Enable Monitoring
                  </Button>
                </Tooltip>
              )}
            {step === "results" &&
              task === "real_time" &&
              (executionMethod === "realtime_guardrail" ||
                executionMethod === "realtime_manually") && (
                <Button
                  variant="outline"
                  background="black"
                  color="white"
                  borderColor="black"
                  _hover={{
                    background: "gray.700",
                  }}
                  onClick={() =>
                    setWizardState({
                      workspaceTab: "code-implementation",
                    })
                  }
                >
                  <LuCode />
                  Show Code
                </Button>
              )}
            {step === "results" && task !== "real_time" && (
              <RunEvaluationButton colorPalette="green">
                Run Evaluation
              </RunEvaluationButton>
            )}
          </HStack>
        </>
      )}
    </VStack>
  );
});
