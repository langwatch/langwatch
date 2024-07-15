import { Text } from "@chakra-ui/react";
import { api } from "../../utils/api";
import { useRouter } from "next/router";
import ErrorPage from "next/error";
import { DashboardLayout } from "../../components/DashboardLayout";
import { TraceDetails } from "../../components/traces/TraceDetails";

export default function SharePage() {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : "";
  const publicShare = api.share.getShared.useQuery({ id }, { enabled: !!id });

  if (publicShare.error) {
    return <Text>Error loading shared item</Text>;
  }

  if (!publicShare.isSuccess) {
    return null;
  }

  if (!publicShare.data || publicShare.data.resourceType !== "TRACE") {
    // only trace supported for now
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout publicPage>
      <TraceDetails traceId={publicShare.data.resourceId} />
    </DashboardLayout>
  );
}
