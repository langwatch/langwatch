import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * /ops/backoffice entry — redirects to the default resource (Users). The
 * per-resource pages under ./backoffice/* are the real surfaces.
 */
export default function BackofficeIndex() {
  const router = useRouter();

  useEffect(() => {
    void router.replace("/ops/backoffice/users");
  }, [router]);

  return null;
}
