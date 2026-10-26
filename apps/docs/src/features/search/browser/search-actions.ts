import { sitePath } from "../../../lib/site-path.ts";

export async function runQuickAction({ id }: { id: string }) {
  if (id === "theme") {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* Storage is optional. */
    }
  } else if (id === "copy") {
    const slug = document.querySelector<HTMLElement>("[data-docs-page-copy]")?.dataset.docsPageCopy;
    if (!slug) throw new Error("Page export unavailable");
    const response = await fetch(sitePath({ path: `/${slug}.md` }), { credentials: "omit" });
    if (!response.ok) throw new Error("Markdown unavailable");
    await navigator.clipboard.writeText(await response.text());
  }
}
