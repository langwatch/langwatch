import { useEffect } from "react";
import { useRouter } from "~/utils/compat/next-router";

/**
 * Legacy /admin entry point — redirects to /ops/backoffice.
 *
 * The admin CRUD UI moved into the OPS section as a Backoffice module
 * (PR: feat(ops): lift admin into Backoffice module with ops design system,
 * referencing #3247 and #3245). This redirect preserves existing bookmarks
 * for at least one release.
 *
 * react-admin's singular resource names (/admin/user, /admin/subscription,
 * etc.) are mapped to the new Chakra Backoffice routes so deep links stay
 * working.
 */
const RESOURCE_REDIRECTS: Record<string, string> = {
  user: "users",
  users: "users",
  organization: "organizations",
  organizations: "organizations",
  project: "projects",
  projects: "projects",
  subscription: "subscriptions",
  subscriptions: "subscriptions",
  organizationfeature: "organization-features",
  organizationfeatures: "organization-features",
};

export default function AdminRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { pathname, search, hash } = window.location;
    const rest = pathname.startsWith("/admin")
      ? pathname.slice("/admin".length).replace(/^\/+/, "")
      : "";

    const [firstSegment, ...deeper] = rest.split("/").filter(Boolean);
    let target = "/ops/backoffice";
    if (firstSegment) {
      const mapped = RESOURCE_REDIRECTS[firstSegment.toLowerCase()];
      if (mapped) {
        target = `/ops/backoffice/${mapped}`;
        if (deeper.length > 0) target += `/${deeper.join("/")}`;
      }
    }

    void router.replace(`${target}${search}${hash}`);
  }, [router]);

  return null;
}
