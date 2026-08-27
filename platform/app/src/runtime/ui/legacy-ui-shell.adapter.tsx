import { UiApplicationShell, UiShellPort } from "@langwatch/ui";
import type { ReactNode } from "react";
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
    return <UiApplicationShell outerProvider={OuterProviders} router={router} />;
  }
}
