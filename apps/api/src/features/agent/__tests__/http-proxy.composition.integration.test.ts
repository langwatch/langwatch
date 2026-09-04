/**
 * The studio's outbound dispatch, composed as its own feature.
 *
 * Two things are pinned here, and they are the two halves of the same seam:
 * the dispatch relays the engine's own server events back to the watcher when
 * a gateway is composed, and refuses BY NAME when one is not — rather than
 * dispatching an event nothing receives.
 */
import {
  HttpWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
} from "@langwatch/workflow-server";
import { describe, expect, it, vi } from "vitest";
import { composeApiStudioHost } from "../../../app/api-studio-host.composition";
import { composeHttpProxyFeature } from "../http-proxy.composition";

const noop = () => undefined;

describe("given the studio dispatch composed on this process", () => {
  describe("when it dispatches an event to an engine that answers", () => {
    it("relays the engine's own server events back to the watcher", async () => {
      const frames = [
        'data: {"type":"component_state_change","payload":{"component_id":"node-1"}}\n\n',
        'data: {"type":"done","payload":{}}\n\n',
      ];
      const encoder = new TextEncoder();
      const engine = vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
          },
        }),
      })) as unknown as typeof fetch;

      const seen: Array<{ type: string }> = [];
      const dispatch = WorkflowStudioDispatchService.create({
        stream: HttpWorkflowStudioStreamAdapter.create({
          serviceUrl: "http://127.0.0.1:5561",
          fetch: engine,
        }),
        modelProviders: { getForProject: async () => ({}) } as never,
      });

      await dispatch.postEvent({
        projectId: "project-1",
        event: { type: "execute_flow", payload: { node_id: "node-1" } } as never,
        onEvent: (event) => seen.push(event as { type: string }),
      });

      expect(seen.map((event) => event.type)).toEqual(["component_state_change", "done"]);
    });
  });

  describe("when the process composed no provider gateway", () => {
    it("refuses the dispatch by name rather than dispatching without one", async () => {
      const studio = composeApiStudioHost({
        nlpServiceUrl: undefined,
        modelProviders: undefined,
        processName: "langwatch-api",
      });
      // Composed the way the process composes it, so what refuses is the port
      // the mounted namespace carries rather than a second one built here.
      composeHttpProxyFeature({ studio });

      await expect(
        studio.ports().postStudioEvent(undefined, {
          projectId: "project-1",
          event: { type: "is_alive", payload: {} } as never,
          onEvent: noop,
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        meta: { capability: "the studio event dispatch" },
      });
    });
  });
});
