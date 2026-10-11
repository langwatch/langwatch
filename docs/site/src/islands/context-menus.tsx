import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { createRoot } from "react-dom/client";

import { PageMenu } from "../shell/page-menu.tsx";
import { ThemeMenu } from "../shell/theme-menu.tsx";
import { docsSystem } from "../theme.ts";

const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();
document.addEventListener("click", (event) => {
  const trigger =
    event.target instanceof Element
      ? event.target.closest("[data-docs-page-menu], [data-docs-theme]")
      : null;
  const container = trigger?.closest<HTMLElement>("[data-docs-menu-root]");
  if (!container || roots.has(container)) return;
  const root = createRoot(container);
  roots.set(container, root);
  container.dataset.mounted = "true";
  root.render(
    <DesignSystemProvider system={docsSystem}>
      {container.dataset.docsMenuRoot === "theme" ? (
        <ThemeMenu initialOpen />
      ) : (
        <PageMenu slug={container.dataset.slug ?? "introduction"} initialOpen />
      )}
    </DesignSystemProvider>,
  );
});
document.addEventListener("docs:leaving", () => {
  for (const [container, root] of roots) {
    if (container.dataset.docsMenuRoot === "page") {
      root.unmount();
      roots.delete(container);
    }
  }
});
