import slugify from "slugify";

export const experimentSlugify = (name: string) => {
  return slugify(name.replace(/[:\?&_]/g, "-"), {
    lower: true,
    strict: true,
    replacement: "-",
  });
};
