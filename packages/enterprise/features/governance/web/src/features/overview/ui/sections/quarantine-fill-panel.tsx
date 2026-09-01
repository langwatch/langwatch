import { QuarantineFillAlert as EnterpriseQuarantineFillAlert } from "../elements/quarantine-fill-alert";
import { Link } from "../../../../ui/elements/governance-link";
import { api } from "../../../../behavior/governance-api";
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
