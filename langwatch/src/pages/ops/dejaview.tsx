import { useEffect } from "react";
import { useRouter } from "next/router";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { DejaViewContent } from "~/components/ops/dejaview";

export default function OpsDejaViewPage() {
  const router = useRouter();
  const { hasAccess, isLoading: opsLoading } = useOpsPermission();

  useEffect(() => {
    if (!opsLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, opsLoading, router]);

  if (opsLoading || !hasAccess) return null;

  return <DejaViewContent />;
}
