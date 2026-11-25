import type { PersonalTokenMint } from "@langwatch/api-key-client";
import { PersonalAccessTokenBanner } from "@langwatch/design-system/personal-access-token-banner";
import type React from "react";

import { useOnboardingHost } from "../../../model/onboarding-host.ts";

/** Mints the holder's personal access token on click; the holder keeps it in memory only. */
export function ProjectTokenBanner({
  minting,
}: {
  minting: PersonalTokenMint;
}): React.ReactElement {
  const host = useOnboardingHost();

  function create(): void {
    minting
      .mint()
      .catch((error: unknown) =>
        host.failed({ error, fallbackTitle: "Couldn't create a personal access token" }),
      );
  }

  return (
    <PersonalAccessTokenBanner
      token={minting.token ?? null}
      isCreating={minting.isMinting}
      onCreate={create}
      scopeNote={minting.scopeNote}
      createLabel="Create a key"
    />
  );
}
