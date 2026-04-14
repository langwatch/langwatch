import { useEffect } from "react";
import { useRouter } from "next/router";

export default function OpsQueuesPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/ops");
  }, [router]);
  return null;
}
