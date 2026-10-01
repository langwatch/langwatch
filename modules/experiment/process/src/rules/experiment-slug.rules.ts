/** A draft name and an archived-slug disambiguator; never a row's own id. */
export const EXPERIMENT_DISAMBIGUATOR_KSUID_RESOURCE = "expdisambig";

/**
 * The slug an experiment is saved under. Kept byte-for-byte so a slug
 * computed today matches one computed before it.
 */
export function slugifyExperimentName(value: string): string {
  return value
    .replaceAll(/[:?&_]/g, "-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
