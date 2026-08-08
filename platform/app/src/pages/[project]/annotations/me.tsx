import { Flex } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";

export default function Annotations() {
  return (
    <AnnotationsLayout>
      <Flex direction="column" flex={1} minWidth={0} height="full">
        <AnnotationsTable
          noDataTitle="No queued annotations for you"
          noDataDescription="You have no annotations assigned to you."
          heading="My Queue"
          dateColumnLabel="Date queued"
          showStatusFilter={true}
          rowTarget="queueItem"
        />
      </Flex>
    </AnnotationsLayout>
  );
}
