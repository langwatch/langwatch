/**
 * Topic's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  TopicHostApi,
  TopicHostProvider,
  type TopicFailureNotice,
  type TopicHostProject,
  type TopicSuccessNotice,
} from "../model/topic-host.ts";

class CapabilityTopicHost extends TopicHostApi {
  constructor(private readonly deps: { projectId: string | undefined; feedback: UiFeedback }) {
    super();
  }

  project(): TopicHostProject | undefined {
    return this.deps.projectId ? { id: this.deps.projectId } : void 0;
  }

  succeeded(notice: TopicSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: TopicFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function TopicHostMount({ children }: { children?: ReactNode }) {
  const { feedback } = useUiCapabilities();
  const { projectId } = useUiScope().activeScope();
  const host = useMemo(
    () => new CapabilityTopicHost({ projectId: projectId ?? void 0, feedback }),
    [projectId, feedback],
  );
  return <TopicHostProvider value={host}>{children}</TopicHostProvider>;
}
