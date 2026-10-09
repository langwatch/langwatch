/**
 * What a shell served without its public config shows: the dev server could not reach the api
 * yet. The branded card, polling its own address until the shell carries the config, then reload.
 * Spec: specs/ui/dev-public-config.feature
 */

import { UiShell } from "@langwatch/browser/shell";
import { PUBLIC_APP_CONFIG_META_NAME } from "@langwatch/config/public-app-config";
import { BrandedCard, BrandedCardPage } from "@langwatch/design-system/branded-card";
import { HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { useEffect, type ReactNode } from "react";

const FIRST_POLL_MS = 1_000;
const LONGEST_POLL_MS = 5_000;

/** Whether the shell this page was served in carries the public config meta tag. */
export function shellCarriesPublicConfig(html: string): boolean {
  return html.includes(`name="${PUBLIC_APP_CONFIG_META_NAME}"`);
}

export function hasInjectedPublicConfig(documentRoot: Document): boolean {
  return documentRoot.querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`) !== null;
}

/** Polls the page's own address, 1s backing off to 5s, and reloads once the config is in it. */
function useReloadOnceConfigured(): void {
  useEffect(() => {
    let delay = FIRST_POLL_MS;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const shell = await fetch(window.location.href, {
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
        if (shellCarriesPublicConfig(await shell.text())) return window.location.reload();
      } catch {
        // The dev server itself is restarting: the next poll asks again.
      }
      delay = Math.min(LONGEST_POLL_MS, delay * 1.5);
      timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), delay);
    return () => clearTimeout(timer);
  }, []);
}

export function UiWaitingForApiPage() {
  useReloadOnceConfigured();
  return (
    <BrandedCardPage>
      <BrandedCard
        title="LangWatch is starting"
        intro="The api is not answering yet. This page opens by itself the moment it does."
        cardAttributes={{ "data-testid": "waiting-for-api-page" }}
      >
        <HStack justify="center" gap={2}>
          <Spinner size="sm" color="fg.muted" />
          <Text fontSize="sm" color="fg.muted">
            Waiting for the api
          </Text>
        </HStack>
      </BrandedCard>
    </BrandedCardPage>
  );
}

/** The shell mounted in place of the application while the config is missing. */
export class UiWaitingForApiShell extends UiShell {
  prepare(): void {}

  render(): ReactNode {
    return (
      <DesignSystemProvider>
        <UiWaitingForApiPage />
      </DesignSystemProvider>
    );
  }
}
