import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/** The payload store is a drawer on the ops dashboard now; old links follow. */
export default function OpsBlobsPage() {
  const router = useRouter();
  useEffect(() => {
    void router.replace("/ops?drawer.open=opsBlobs");
  }, [router]);
  return null;
}
