/** The host an operator knows this install by; the bare phrase when no public URL is set. */
export function installationOf(url: string | null | undefined): string {
  return url && URL.canParse(url) ? new URL(url).host : "this installation";
}
