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
    doneQueueItemsWithTraces,
    queuesLoading,
  } = useAnnotationQueues();

  const uniqueDoneQueueItems = doneQueueItemsWithTraces?.filter(
    (item, index, self) =>
      index === self.findIndex((t) => t.trace.id === item.trace.id)
  );
  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 320px)"} padding={6}>
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
          Annotations
        </Heading>
        <Heading as={"h4"} size="md" fontWeight="normal">
          Done
        </Heading>
        <AnnotationsTable
          allQueueItems={uniqueDoneQueueItems}
          queuesLoading={queuesLoading}
          isDone={true}
        />
      </Container>
    </AnnotationsLayout>
  );
}
