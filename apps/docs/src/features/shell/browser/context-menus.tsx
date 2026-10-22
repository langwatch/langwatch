import { SystemProvider } from "@langwatch/design-system/system-provider";
import { createRoot } from "react-dom/client";

import { docsMenuSystem } from "../../../app/island-theme.ts";
import { contextualOptions } from "../../navigation/model/nav.ts";
import { PageMenu } from "../ui/page-menu.tsx";
import { ThemeMenu } from "../ui/theme-menu.tsx";

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
    <SystemProvider system={docsMenuSystem}>
      {container.dataset.docsMenuRoot === "theme" ? (
        <ThemeMenu initialOpen />
      ) : (
        <PageMenu
          slug={container.dataset.slug ?? "introduction"}
          actions={contextualOptions({ options: (container.dataset.actions ?? "").split(" ") })}
          initialOpen
        />
      )}
    </SystemProvider>,
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
