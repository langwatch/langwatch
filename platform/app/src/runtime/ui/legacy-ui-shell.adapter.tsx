import { UiShellPort } from "@langwatch/ui";
import { Suspense, type ReactNode } from "react";
import { RouterProvider } from "react-router/dom";
import { OuterProviders } from "../../AppProviders";
import { router } from "../../routes";
import { registerChunkReloadListener } from "../../utils/chunkReload";
import { setRouterInstance } from "../../utils/compat/next-router";

export class LegacyUiShellAdapter extends UiShellPort {
  static create(): LegacyUiShellAdapter {
    return new LegacyUiShellAdapter();
  }

  private constructor() {
    super();
  }

  prepare(): void {
    setRouterInstance(router);
    registerChunkReloadListener();
  }

  render(): ReactNode {
    return (
      <OuterProviders>
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
      </OuterProviders>
    );
  }
}
