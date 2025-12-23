import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { DatasetTable } from "../../../components/datasets/DatasetTable";

export default function Dataset() {
  const router = useRouter();
  const datasetId = router.query.id;

  return (
    <DashboardLayout>
      <DatasetTable datasetId={datasetId as string} />
    </DashboardLayout>
  );
}
