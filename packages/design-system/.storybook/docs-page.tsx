import {
  Controls,
  Description,
  Markdown,
  Primary,
  Stories,
  Subtitle,
  Title,
  useOf,
} from "@storybook/addon-docs/blocks";

import { adoption, entriesForStory } from "./adoption-data.ts";

/** A story's `parameters.usage`: when to reach for it, and what to use instead. */
export type Usage = { use: string; avoid?: string };

function usageMarkdown({ usage }: { usage: Usage }): string {
  const avoid = usage.avoid ? `\n\n**When not to.** ${usage.avoid}` : "";
  return `**When to use.** ${usage.use}${avoid}`;
}

function adoptionMarkdown({ fileName }: { fileName: string }): string | undefined {
  if (!adoption) return undefined;
  const entries = entriesForStory({ fileName });
  if (entries.length === 0) return undefined;
  const rows = entries.map(([subpath, entry]) => {
    const owners = Object.entries(entry.owners)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([owner, files]) => `${owner} (${files})`)
      .join(", ");
    const names = Object.entries(entry.names)
      .slice(0, 8)
      .map(([name, files]) => `${name} ${files}`)
      .join(", ");
    const module = `@langwatch/design-system${subpath.slice(1)}`;
    return `| \`${module}\` | ${entry.files} | ${Object.keys(entry.owners).length} | ${owners || "none yet"} | ${names} |`;
  });
  return [
    "**Adoption.** Files that import it today, counted from the import sites when this workshop was built.",
    "",
    "| Import | Files | Packages | Most used in | Names imported (files) |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** Every docs page: what it is, when to use it, how widely it is used, then the stories. */
export function DocsPage() {
  const resolved = useOf("meta");
  const parameters = resolved.type === "meta" ? resolved.preparedMeta.parameters : {};
  const { fileName, usage } = parameters as { fileName?: string; usage?: Usage };
  const adoptionNote = fileName ? adoptionMarkdown({ fileName }) : undefined;
  return (
    <>
      <Title />
      <Subtitle />
      <Description />
      {usage ? <Markdown>{usageMarkdown({ usage })}</Markdown> : null}
      {adoptionNote ? <Markdown>{adoptionNote}</Markdown> : null}
      <Primary />
      <Controls />
      <Stories />
    </>
  );
}
