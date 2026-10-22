import { sitePath, stripBasePath } from "../../../lib/site-path.ts";
import { matchRedirect, type RedirectRules } from "../model/redirect-match.ts";

/* Loaded on the 404 page only: a static host serves exact redirects as pages, but a pattern
   such as "/guardrails/:path*" needs this, so an old address still lands on its new page. */
async function redirectFromNotFound() {
  const path = stripBasePath({ pathname: location.pathname });
  if (path === null) return;
  const response = await fetch(sitePath({ path: "/redirects.json" }), { credentials: "omit" });
  if (!response.ok) return;
  const destination = matchRedirect({ path, redirects: (await response.json()) as RedirectRules });
  if (!destination) return;
  const target = new URL(
    /^https?:\/\//.test(destination) ? destination : sitePath({ path: destination }),
    location.origin,
  );
  for (const [key, value] of new URLSearchParams(location.search))
    if (!target.searchParams.has(key)) target.searchParams.append(key, value);
  if (!target.hash) target.hash = location.hash;
  location.replace(target.href);
}

void redirectFromNotFound().catch(() => {});
