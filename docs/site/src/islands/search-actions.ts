export const QUICK_ACTIONS = [
  {
    id: "app",
    title: "Open app",
    href: "https://app.langwatch.ai",
    description: "Go to your LangWatch workspace",
  },
  {
    id: "github",
    title: "GitHub",
    href: "https://github.com/langwatch/langwatch",
    description: "Explore the source and contribute",
  },
  { id: "theme", title: "Toggle theme", href: "", description: "Switch between light and dark" },
  { id: "copy", title: "Copy page", href: "", description: "Copy this page as Markdown for LLMs" },
];
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
    const slug = location.pathname.replace(/^\/+|\/+$/g, "") || "introduction";
    const response = await fetch(`/${slug}.md`, { credentials: "omit" });
    if (!response.ok) throw new Error("Markdown unavailable");
    await navigator.clipboard.writeText(await response.text());
  }
}
