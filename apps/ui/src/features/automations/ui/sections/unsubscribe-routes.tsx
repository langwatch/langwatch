/**
 * Which page key the unsubscribe landing answers: no guard, no host. ADR-031
 * makes the `?token=` HMAC the authorization, binding it to one recipient —
 * a guard would refuse the only person the link was ever minted for.
 */

import { unsubscribeScreens } from "@langwatch/automation-web/screens/unsubscribe";
import type { ComponentType } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";

/** Reads the token out of the address and hands it to the screen. */
function withTokenFromAddress(Screen: ComponentType<{ token: string }>): ComponentType {
  const OnToken = () => {
    const { route } = useUiCapabilities();
    return <Screen token={route.reading().query.token ?? ""} />;
  };
  OnToken.displayName = "UnsubscribePage";
  return OnToken;
}

export const unsubscribePageLoaders: UiPageLoaderRegistry = {
  "pages/unsubscribe": uiPage({
    screen: async () => {
      const module = await unsubscribeScreens.unsubscribe();
      return { default: withTokenFromAddress(module.default) };
    },
  }),
};
