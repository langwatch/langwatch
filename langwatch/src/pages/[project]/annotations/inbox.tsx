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

  return (
    <AnnotationsLayout>
      <Container maxWidth={"calc(100vw - 360px)"} padding={6}>
        <AnnotationsTable
          heading="Inbox"
          allQueueItems={allQueueItems}
          queuesLoading={queuesLoading}
          noDataTitle="Your inbox is empty"
          noDataDescription="Send messages to your annotation queue to get started."
        />
      </Container>
    </AnnotationsLayout>
  );
}
