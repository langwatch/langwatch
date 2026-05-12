/**
 * Builds a full platform URL for a resource so API consumers can link
 * directly to it in the LangWatch UI.
 *
 * Uses BASE_HOST (the external-facing origin) with the project slug
 * and a resource-specific path.
 *
 * Example: "https://app.langwatch.ai/my-project/datasets/ds_abc123"
 */
export function platformUrl({
  projectSlug,
  path,
}: {
  projectSlug: string;
  path: string;
}): string {
  const base = (process.env.BASE_HOST ?? "http://localhost:5560").replace(
    /\/+$/,
    "",
  );
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}/${projectSlug}${cleanPath}`;
}
