import { DashboardLayout } from "~/components/DashboardLayout";

import { DatasetTable } from "../../../components/datasets/DatasetTable";

export default function Dataset() {
  return (
    <DashboardLayout>
      <DatasetTable />
    </DashboardLayout>
  );
}
