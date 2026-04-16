import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Legacy /admin entry point — redirects to /ops/backoffice.
 *
 * The admin CRUD UI moved into the OPS section as a Backoffice module
 * (PR: feat(ops): lift admin into Backoffice module with ops design system,
 * referencing #3247 and #3245). This redirect preserves existing bookmarks
 * for at least one release.
 */
export default function AdminRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { pathname, search, hash } = window.location;
    const suffix = pathname.startsWith("/admin")
      ? pathname.slice("/admin".length)
      : "";
    const target = `/ops/backoffice${suffix}${search}${hash}`;
    // Use replace so the /admin URL doesn't end up in back-button history.
    void router.replace(target);
  }, [router]);

  return null;
}
