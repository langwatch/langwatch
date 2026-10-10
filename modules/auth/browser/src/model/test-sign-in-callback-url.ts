/**
 * Where a connection's test sign-in returns to: the page that offered it,
 * carrying the query that page asked for. The caller decides what the query
 * says; this only puts it on the address.
 */
export function testSignInCallbackUrl({
  href,
  query,
}: {
  href: string;
  query: Readonly<Record<string, string | undefined>>;
}): string {
  const target = new URL(href);
  target.search = "";
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) target.searchParams.set(key, value);
  }

  return target.toString();
}
