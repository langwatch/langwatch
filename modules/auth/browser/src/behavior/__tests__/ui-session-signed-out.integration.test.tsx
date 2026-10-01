/**
 * A signed-out reader on the sign-in screen asks the server nothing that only
 * a session can answer: a flag read would come back 401.
 * @vitest-environment jsdom
 */

import type { UiActiveScopeReading, UiSessionReading } from "@langwatch/browser-host/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useBrowserUiSession } from "../ui-session";
import { UI_FEATURE_FLAG_PROCEDURE, type UiFeatureApiTransport } from "../ui-session-queries";
import { answeringTransport } from "./answering-transport.test-helpers";

const SIGNED_OUT: UiSessionReading = { status: "anonymous", user: null };
const JANE: UiSessionReading = {
  status: "authenticated",
  user: { id: "user-jane", name: "Jane", email: null, image: null },
};
const UNSCOPED: UiActiveScopeReading = {
  status: "unavailable",
  organization: void 0,
  team: void 0,
  project: void 0,
};

function FlagProbe({
  transport,
  session,
}: {
  transport: UiFeatureApiTransport;
  session: UiSessionReading;
}) {
  const ui = useBrowserUiSession({ transport, session, scope: UNSCOPED });
  return <span data-testid="flag">{String(ui.featureFlag("release_ui_sign_in"))}</span>;
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function renderProbe({ session }: { session: UiSessionReading }): string[] {
  const asked: string[] = [];
  const transport = answeringTransport(async (path) => {
    asked.push(path);
    return { enabled: true };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FlagProbe transport={transport} session={session} />
    </QueryClientProvider>,
  );
  dispose = () => {
    view.unmount();
    client.clear();
  };
  return asked;
}

describe("given the sign-in screen", () => {
  describe("when no one is signed in", () => {
    it("never asks the server for a feature flag", async () => {
      const asked = renderProbe({ session: SIGNED_OUT });
      await new Promise((settle) => setTimeout(settle, 50));
      expect(asked).not.toContain(UI_FEATURE_FLAG_PROCEDURE);
    });
  });

  describe("when a user is signed in", () => {
    it("asks for the flag, proving the probe reaches the server", async () => {
      const asked = renderProbe({ session: JANE });
      await waitFor(() => expect(asked).toContain(UI_FEATURE_FLAG_PROCEDURE));
    });
  });
});
