import { DashboardLayout } from "~/components/DashboardLayout";

import { DatasetTable } from "../../../components/datasets/DatasetTable";
import { useRouter } from "next/router";
import { Container } from "@chakra-ui/react";

export default function Dataset() {
  const router = useRouter();
  const datasetId = router.query.id;

  return (
    <DashboardLayout>
      <Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <DatasetTable datasetId={datasetId as string} />
      </Container>
    </DashboardLayout>
  );
}
