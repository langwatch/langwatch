/**
 * GitHub's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
} from "@langwatch/browser-host/capabilities";
import { uiLeaveTo, uiOpenExternal } from "@langwatch/browser-host/navigation";
import { useMemo, type ReactNode } from "react";

import {
  GithubHostApi,
  GithubHostProvider,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "../model/github-host.ts";

class CapabilityGithubHost extends GithubHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      route: UiRoute;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  scope(): GithubHostScope {
    return { organizationId: this.deps.organizationId };
  }

  route(): GithubRouteReading {
    const reading = this.deps.route.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.route.setQuery(next, options);
  }

  leaveTo(url: string): void {
    uiLeaveTo(url);
  }

  openExternal(url: string): void {
    uiOpenExternal(url);
  }

  failed(failure: GithubFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function GithubHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();
  const host = useMemo(
    () => new CapabilityGithubHost({ organizationId: organizationId ?? void 0, route, feedback }),
    [organizationId, route, feedback],
  );
  return <GithubHostProvider value={host}>{children}</GithubHostProvider>;
}
