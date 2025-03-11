import {
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Activity, Edit3 } from "react-feather";
import {
  LuBadgeCheck,
  LuChevronRight,
  LuListChecks,
  LuShield,
} from "react-icons/lu";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { ColorfulBlockIcon } from "../../optimization_studio/components/ColorfulBlockIcons";
import { LogoIcon } from "../icons/LogoIcon";
import { Dialog } from "../ui/dialog";
import { Steps } from "../ui/steps";
import { StepButton } from "./StepButton";

export function EvaluationWizard() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [isSticky, setIsSticky] = useState(false);
  const stickyRef = useRef<HTMLDivElement>(null);

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
            <Steps.Root size="sm" count={5} width="full">
              <Steps.List>
                <Steps.Item index={0} title="Task" />
                <Steps.Item index={1} title="Dataset" />
                <Steps.Item index={2} title="Executor" />
                <Steps.Item index={3} title="Evaluator" />
                <Steps.Item index={4} title="Results" />
              </Steps.List>
            </Steps.Root>
            <VStack align="start" paddingTop={6}>
              <Heading as="h2" size="md">
                What are you trying to do?
              </Heading>
              <Text>Select what evaluation flow you want to follow</Text>
            </VStack>
            <VStack width="full" gap={3}>
              <StepButton
                title="Set up real-time evaluation"
                description="Evaluate messages as they arrive in production"
                icon={
                  <ColorfulBlockIcon
                    color="green.400"
                    size="md"
                    icon={<Activity />}
                    marginTop="-2px"
                  />
                }
              />
              <StepButton
                title="Evaluate your LLM pipeline"
                description="Run a batch evaluation of dataset examples against your existing LLM application"
                icon={
                  <ColorfulBlockIcon
                    color="blue.400"
                    size="md"
                    icon={<LuListChecks />}
                    marginTop="-2px"
                  />
                }
                disabled
              />
              <StepButton
                title="Prompt Creation"
                description="Build a new prompt and evaluate the quality of the outputs, iteratively improving it"
                icon={
                  <ColorfulBlockIcon
                    color="purple.400"
                    size="md"
                    icon={<Edit3 />}
                    marginTop="-2px"
                  />
                }
                disabled
              />
              <StepButton
                title="Create Custom Evaluator"
                description="Build your own reliable evaluator to be used by other flows, measuring and ensuring its accuracy"
                icon={
                  <ColorfulBlockIcon
                    color="orange.400"
                    size="md"
                    icon={<LuBadgeCheck />}
                    marginTop="-2px"
                  />
                }
                disabled
              />
              <StepButton
                title="Scan for Vulnerabilities (Coming Soon)"
                description="Run malicious datasets and adversarial attacks against your LLM application for Red Teaming"
                icon={
                  <ColorfulBlockIcon
                    color="teal.400"
                    size="md"
                    icon={<LuShield />}
                    marginTop="-2px"
                  />
                }
                disabled
              />
            </VStack>
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
            <Button variant="outline">
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
        ></VStack>
      </Dialog.Body>
    </Dialog.Content>
  );
}
