import { Container } from "@chakra-ui/react";
import AnnotationsLayout from "~/components/AnnotationsLayout";
import { AnnotationsTable } from "~/components/annotations/AnnotationsTable";

export default function Annotations() {
  return (
    <AnnotationsLayout>
      <Container
        maxWidth={"calc(100vw - 330px)"}
        padding={0}
        margin={0}
        backgroundColor="white"
      >
        <AnnotationsTable
          noDataTitle="No queued annotations for you"
          noDataDescription="You have no annotations assigned to you."
          heading="My Queue"
        />
      </Container>
    </AnnotationsLayout>
  );
}
