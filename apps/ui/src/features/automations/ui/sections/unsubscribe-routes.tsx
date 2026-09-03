/**
 * Which page key the unsubscribe landing answers, and what it is NOT wrapped
 * in.
 *
 * NO GUARD AND NO HOST, and both absences are deliberate. ADR-031 makes the
 * `?token=` the authorization — its HMAC binds it to one recipient — so a
 * permission guard would refuse the only person the link was ever minted for,
 * and a host port that answers for the session, the organization and the
 * project has nothing to say about somebody who is not signed in.
 *
 * THE TOKEN IS READ HERE. The screen takes it as a prop, so the address is read
 * once, by the half of the application that owns addresses, and the screen stays
 * a screen. Nothing else about the query travels: the token reaches exactly one
 * procedure and is never written anywhere this application controls.
 */

import { unsubscribeScreens } from "@langwatch/automation-web/screens/unsubscribe";
import type { ComponentType } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";

/** Reads the token out of the address and hands it to the screen. */
function withTokenFromAddress(Screen: ComponentType<{ token: string }>): ComponentType {
  const OnToken = () => {
    const { route } = useUiCapabilities();
    return <Screen token={route.reading().query.token ?? ""} />;
  };
  OnToken.displayName = "UnsubscribePage";
  return OnToken;
}

const unsubscribePage: UiPageLoader = async () => {
  const module = await unsubscribeScreens.unsubscribe();
  return { default: withTokenFromAddress(module.default) };
};

export const unsubscribePageLoaders: UiPageLoaderRegistry = {
  "pages/unsubscribe": unsubscribePage,
};
