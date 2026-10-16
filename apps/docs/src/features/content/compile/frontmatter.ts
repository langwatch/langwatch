import { parse } from "yaml";
import { z } from "zod";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
/* YAML scalars read as text (`title: 2024` is "2024"); anything else reads as absent. */
const text = z
  .union([z.string(), z.number(), z.boolean()])
  .transform(String)
  .optional()
  .catch(undefined);
const pageFrontmatterSchema = z
  .looseObject({
    title: text,
    description: text,
    sidebarTitle: text,
    openapi: text,
    mode: text,
    icon: text,
  })
  .catch({});
export type PageFrontmatter = z.infer<typeof pageFrontmatterSchema>;

/** A page's frontmatter fields; absent, unparseable or non-mapping YAML reads as empty. */
export function readFrontmatter({ source }: { source: string }): PageFrontmatter {
  const match = FRONTMATTER.exec(source);
  if (!match) return {};
  try {
    return pageFrontmatterSchema.parse(parse(match[1]) ?? {});
  } catch {
    return {};
  }
}

export function withoutFrontmatter({ source }: { source: string }) {
  return source.replace(FRONTMATTER, "");
}
