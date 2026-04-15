import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

export default function OpsQueuesPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/ops");
  }, [router]);
  return null;
}
