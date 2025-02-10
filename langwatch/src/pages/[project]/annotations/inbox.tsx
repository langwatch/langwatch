import {
  Avatar,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Skeleton,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import { HelpCircle } from "react-feather";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import AnnotationsLayout from "~/components/AnnotationsLayout";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";

export default function Annotations() {
  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    queuesLoading,
    scoreOptions,
  } = useAnnotationQueues();

  const allQueueItems = [
    ...(assignedQueueItemsWithTraces ?? []),
    ...(memberAccessibleQueueItemsWithTraces ?? []),
  ];

  const scoreOptionsIDArray = scoreOptions.data
    ? scoreOptions.data.map((scoreOption) => scoreOption.id)
    : [];

  type ScoreOption = {
    value: string | string[];
    reason?: string | null;
  };
  const annotationScoreValues = (
    scoreOptions: Record<string, ScoreOption>,
    scoreOptionsIDArray: string[]
  ) => {
    if (scoreOptionsIDArray.length > 0 && scoreOptions) {
      console.log("scoreOptions", scoreOptions);
      return scoreOptionsIDArray.map((id) => (
        <Td key={id}>
          <HStack>
            <Text>
              {" "}
              {Array.isArray(scoreOptions[id]?.value)
                ? scoreOptions[id]?.value.join(", ")
                : scoreOptions[id]?.value}
            </Text>
            {scoreOptions[id]?.reason && (
              <Tooltip label={scoreOptions[id]?.reason}>
                <HelpCircle width={16} height={16} />
              </Tooltip>
            )}
          </HStack>
        </Td>
      ));
    } else {
      if (scoreOptionsIDArray.length > 0) {
        return scoreOptionsIDArray.map((_, i) => <Td key={i}></Td>);
      }
      return <Td></Td>;
    }
  };

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 320px)"} padding={6}>
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
          Annotations
        </Heading>
        <Heading as={"h4"} size="md" fontWeight="normal">
          Inbox
        </Heading>
        <AnnotationsTable
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
        />
      </Container>
    </AnnotationsLayout>
  );
}
