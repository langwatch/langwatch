import { Flex } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";
import { useRequiredSession } from "~/hooks/useRequiredSession";

export default function Annotations() {
  const { data: session } = useRequiredSession();
  const userId = session?.user?.id;

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
          // This page is the reviewer's own queue, so moving a selection
          // elsewhere starts from them being on it.
          pageQueue={
            userId
              ? {
                  annotatorId: `user-${userId}`,
                  name: session?.user?.name ?? "You",
                }
              : undefined
          }
        />
      </Flex>
    </AnnotationsLayout>
  );
}
