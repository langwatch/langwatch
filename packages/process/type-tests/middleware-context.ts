import {
  bindMiddlewareContext,
  defineMiddlewareContext,
  defineRestRouter,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { expectTypeOf } from "vitest";
import { z } from "zod";

import { defineProcessModule, type PublishedProcessModule } from "../src/feature-installer.ts";

interface DoorApi {
  ping(): string;
}
const DoorApi = moduleApi<DoorApi>()("platform-health");
class DoorModule implements DoorApi {
  static readonly contract = DoorApi;
  static readonly dependencies = {};
  static create(): DoorModule {
    return new DoorModule();
  }
  readonly monitorDoor: string = "door";
  ping(): string {
    return "pong";
  }
}

// The bindings hook is handed the constructed App, not its contract: no instanceof guard.
defineProcessModule("platform-health")
  .withApi(DoorModule)
  .withTransports()
  .provideMiddlewareBindings(({ app }) => {
    expectTypeOf(app).toEqualTypeOf<DoorModule>();
    expectTypeOf(app.monitorDoor).toEqualTypeOf<string>();
    // @ts-expect-error only what the App declares is there to bind
    void app.cliTokenDoor;
    return [];
  });

const surface = defineMiddlewareContext("surface", z.string().nullable());
const pingRest = defineRestRouter(DoorApi)
  .withNamespace("ping")
  .withVersion("2026-10-10")
  .withAddressing("literal", { v1Twin: false })
  .get("/api/ping", "ping")
  .withAccess({ kind: "public", reason: "The test family authenticates nothing." })
  .withHeaders(z.object({ "x-trace": z.string().optional() }))
  .withMiddlewareContext(surface)
  .withOutput(z.object({ pong: z.string() }))
  .handle(({ app }) => ({ pong: app.ping() }))
  .build();
const withPing = () =>
  defineProcessModule("platform-health").withApi(DoorModule).withTransports(pingRest);

// Every context the module's routes ask for is a key it provides, typed by its schema;
// the `withHeaders` value binds itself.
export const provided: PublishedProcessModule<"platform-health", DoorApi, unknown> =
  withPing().provideMiddlewareContext({
    surface: (request, { app }) => request.headers.get(app.monitorDoor),
  });

// @ts-expect-error a module that never provides the context its routes ask for does not publish
export const unprovided: PublishedProcessModule<"platform-health", DoorApi, unknown> = withPing();

// @ts-expect-error a missing key names the context
withPing().provideMiddlewareContext({});

// @ts-expect-error a value of the wrong type for its schema
withPing().provideMiddlewareContext({ surface: () => 42 });

withPing().provideMiddlewareContext({
  surface: () => null,
  // @ts-expect-error a key no route asks for
  stray: () => null,
});

// A hand-bound context counts as provided, typed by the route's own schema.
export const handBound: PublishedProcessModule<"platform-health", DoorApi, unknown> =
  withPing().provideMiddlewareBindings(() => [bindMiddlewareContext(surface, () => null)]);

// @ts-expect-error a hand-bound list that leaves the route's context out does not publish
export const handMissing: PublishedProcessModule<"platform-health", DoorApi, unknown> =
  withPing().provideMiddlewareBindings(() => []);

const numericSurface = defineMiddlewareContext("surface", z.number());
// @ts-expect-error a hand-bound value the route's schema does not accept
withPing().provideMiddlewareBindings(() => [bindMiddlewareContext(numericSurface, () => 1)]);
