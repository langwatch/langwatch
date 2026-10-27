import slugify from "slugify";

/**
 * The slug a shared team or an organization group is given. Separators (`:`, `?`, `&`, `_`)
 * become dashes before `slugify` sees them, since its character map would expand `&` to "and".
 */
export function organizationResourceSlug(name: string): string {
  return slugify(name.replaceAll(/[:?&_]/g, "-"), {
    lower: true,
    strict: true,
    replacement: "-",
  });
}
