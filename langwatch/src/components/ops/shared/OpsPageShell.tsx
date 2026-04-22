import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { ErrorBoundary } from "react-error-boundary";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { PageErrorFallback } from "~/components/ui/PageErrorFallback";

export function OpsPageShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, isLoading, router]);

  if (isLoading || !hasAccess) return null;

  return (
    <ErrorBoundary FallbackComponent={PageErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}
