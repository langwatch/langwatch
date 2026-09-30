import { Navigate, useSearchParams } from "react-router";

/**
 * Members became the first tab of Directory.
 *
 * The page listed people; the page next to it listed the containers those
 * people sit in; the page after that held the rules by which somebody becomes
 * one. Three entries, one question. They are the Directory now, and the three
 * old tabs became three cuts of its single list.
 *
 * The old tab carries across rather than being dropped on the floor: a support
 * thread that says "there are three people waiting" links to the requests, and
 * that link has to keep landing on the three.
 *
 * A page that renders `<Navigate>`, not a `loader` redirect: loaders do not
 * run on a cold load of the SPA, which is exactly how a stale link arrives.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
const CUT_FOR_OLD_TAB: Record<string, string> = {
  members: "members",
  invitations: "invited",
  requests: "waiting",
};

export default function MembersRedirect() {
  const [searchParams] = useSearchParams();
  const cut = CUT_FOR_OLD_TAB[searchParams.get("tab") ?? ""];
  // Everybody is the default cut, so the members tab — which was the default
  // there too — arrives with no query at all.
  const to =
    cut && cut !== "members"
      ? `/settings/directory?people=${cut}`
      : "/settings/directory";

  return <Navigate to={to} replace />;
}
