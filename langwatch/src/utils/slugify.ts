import originalSlugify from "slugify";

// TODO: use only that for the whole project and prevent the package from being imported elsewhere
export const slugify = (
  str: string,
  options: Parameters<typeof originalSlugify>[1] = {}
) => {
  return originalSlugify(
    str.replaceAll(/[:\?&_]/g, "-"),
    typeof options === "object"
      ? {
          lower: true,
          strict: true,
          replacement: "-",
          ...options,
        }
      : options
  );
};
