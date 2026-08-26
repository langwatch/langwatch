import { QuarantineFillAlert as EnterpriseQuarantineFillAlert } from "@langwatch/enterprise-governance-web";
import { Link } from "~/components/ui/link";
import { api } from "~/utils/api";

/** Application data adapter for the portable Enterprise warning surface. */
export function QuarantineFillAlert({ organizationId }: { organizationId: string }) {
  const { data } = api.governance.quarantineFillStats.useQuery(
    { organizationId },
    {
      enabled: !!organizationId,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: false,
    },
  );

  return (
    <EnterpriseQuarantineFillAlert
      stats={data}
      reviewLink={
        <Link href="/governance/ingestion-sources" fontSize="sm" color="orange.600">
          Review ingestion sources →
        </Link>
      }
    />
  );
}
