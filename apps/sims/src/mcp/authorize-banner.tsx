import { Callout, Link, Stack } from "@langwatch/design-system-internal";

import type { Run } from "./mcp-api.ts";

/** The connect run waits for a person: this is where they approve. */
export const AuthorizeBanner = ({ run }: { run: Run }) => (
  <div data-testid="authorize-banner">
    <Callout tone="warning" title="Waiting for you to approve the OAuth connect">
      <Stack gap={2}>
        <span>
          Open the page in a new tab and approve. The browser returns to the sim's callback and the
          run then passes or fails.
        </span>
        {run.authorizeUrl && (
          <Link href={run.authorizeUrl} external>
            Open the approval page
          </Link>
        )}
      </Stack>
    </Callout>
  </div>
);
