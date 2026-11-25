export type HttpBodyLanguage = "json" | "xml" | "urlencoded" | "plaintext";

/** Picks the editor highlight language from the request's Content-Type header. */
export function httpBodyLanguage({
  headers,
}: {
  headers: { key: string; value: string }[] | undefined;
}): HttpBodyLanguage {
  const header = headers?.find((entry) => entry.key.trim().toLowerCase() === "content-type");
  const type = header?.value.toLowerCase() ?? "";
  if (!type) return "json";
  if (type.includes("json")) return "json";
  if (type.includes("xml")) return "xml";
  if (type.includes("x-www-form-urlencoded")) return "urlencoded";
  return "plaintext";
}

/** Pretty-prints a rendered body when it is JSON; anything else is left as written. */
export function prettyBody({ body }: { body: string }): { code: string; language: string } {
  try {
    return { code: JSON.stringify(JSON.parse(body), null, 2), language: "json" };
  } catch {
    return { code: body, language: "text" };
  }
}
