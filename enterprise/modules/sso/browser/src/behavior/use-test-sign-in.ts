// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Sending yourself to the identity provider and back, from anywhere that
 * offers it. A hook rather than a component, because two surfaces offer the
 * same act with different chrome — a step in the setup journey and a control
 * on the overview — and the one thing that must not differ between them is
 * what pressing it does.
 *
 * The failure is HANDED BACK, not toasted: it is the one thing on the screen
 * the reader has to work from, and a toast is gone in eight seconds, cannot be
 * copied comfortably, and sits nowhere near the connection it is about.
 */
import { useState } from "react";

import { useSsoHost } from "../model/sso-host.ts";
import {
  testSignInCallbackQuery,
  testSignInCallbackVerdict,
} from "../model/test-sign-in-callback.ts";
import {
  testSignInFailureFor,
  testSignInStartFailure,
  type TestSignInFailure,
} from "../model/test-sign-in-failure.ts";

export interface TestSignIn {
  start: () => Promise<void>;
  sending: boolean;
  /** The most recent verdict, whichever half of the round trip produced it. */
  failure: TestSignInFailure | null;
  dismissFailure: () => void;
}

export function useTestSignIn({ connectionId }: { connectionId: string }): TestSignIn {
  const host = useSsoHost();
  const [sending, setSending] = useState(false);
  const [startFailure, setStartFailure] = useState<TestSignInFailure | null>(null);
  // WHAT CAME BACK, not the words for it: the copy for one of our own codes
  // names the reader's own address, which the session may not have handed
  // over on the render this state is first built. Freezing a sentence here
  // left the most useful half of it permanently missing on a cold load.
  const [dismissed, setDismissed] = useState(false);

  const verdict = testSignInCallbackVerdict({ query: host.route().query, connectionId });
  const callbackFailure =
    verdict && !dismissed
      ? testSignInFailureFor({
          code: host.normalizeSignInErrorCode(verdict.code),
          description: verdict.description,
          yourAddress: host.currentUserAddress(),
        })
      : null;

  const start = async (): Promise<void> => {
    setSending(true);
    // A new attempt clears the last one's verdict, so a stale failure can
    // never sit under a button that has just succeeded.
    setStartFailure(null);
    setDismissed(true);
    try {
      const { error } = await host.testSignIn({
        connectionId,
        callbackQuery: testSignInCallbackQuery({ query: host.route().query, connectionId }),
      });
      if (error) setStartFailure(testSignInStartFailure(error));
    } catch (error) {
      setStartFailure(
        testSignInStartFailure({
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSending(false);
    }
  };

  return {
    start,
    sending,
    failure: startFailure ?? callbackFailure,
    dismissFailure: () => {
      setStartFailure(null);
      setDismissed(true);
    },
  };
}
