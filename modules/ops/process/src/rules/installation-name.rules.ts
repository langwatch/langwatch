/** Whether the install has a web address a mail can link to, and that address when it has. */
export type InstallationAddress = { kind: "web"; url: URL } | { kind: "none" };

/** Reads the install's public address; a bare host or another scheme is not a web address. */
export function addressOf(url: string | null | undefined): InstallationAddress {
  if (!url || !URL.canParse(url)) return { kind: "none" };
  const parsed = new URL(url);
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? { kind: "web", url: parsed }
    : { kind: "none" };
}

/** The host an operator knows this install by; the bare phrase when no public URL is set. */
export function installationOf(url: string | null | undefined): string {
  const address = addressOf(url);
  return address.kind === "web" ? address.url.host : "this installation";
}

/** An absolute link to one of the install's pages, when it has a web address to link from. */
export function installationPageOf({
  baseUrl,
  path,
}: {
  baseUrl: string | null | undefined;
  path: string;
}): InstallationAddress {
  const base = addressOf(baseUrl);
  return base.kind === "web" ? { kind: "web", url: new URL(path, base.url) } : base;
}
