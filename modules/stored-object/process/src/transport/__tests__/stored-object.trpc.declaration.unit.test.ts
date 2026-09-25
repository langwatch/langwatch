/**
 * @vitest-environment node
 * The tRPC wire, pinned: procedure name, kind and the access bound to it.
 * @see specs/traces-v2/media-rendering.feature
 */
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import { storedObjectTrpc } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { storedObjectTrpcTransport } from "../stored-object.trpc.ts";

/** Mounts a declaration and records the access each procedure asked for. */
function accessOf(declaration: { router: TrpcRouterMount<never, never> }): unknown[] {
  const declared: unknown[] = [];

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access);

      return {};
    },
    router: (record) => record,
  };

  (declaration.router as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => {
      throw new Error("the wire table never resolves an application");
    },
  );

  return declared;
}

describe("the storedObjects tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("keeps the probe's wire name and kind", () => {
      expect(
        Object.entries(storedObjectTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["headById", "query"],
        ["createUpload", "mutation"],
        ["confirmUpload", "mutation"],
      ]);
      expect(storedObjectTrpc.namespace).toBe("storedObjects");
    });

    /** @scenario "A viewer with trace access can probe trace media" */
    it("admits any file viewer to the probe and leaves the purpose check to the service", () => {
      expect(accessOf(storedObjectTrpcTransport)).toEqual([
        {
          kind: "permission-any",
          permissions: ["traces:view", "scenarios:view", "datasets:view"],
        },
        { kind: "permission", permission: "project:update" },
        { kind: "permission", permission: "project:update" },
      ]);
    });

    /** @scenario "A viewer with trace access can probe trace media" */
    it("answers the probe's three states and nothing else", () => {
      const output = storedObjectTrpc.members.headById?.output;

      expect(output?.validate({ status: "not_found" })).toBe(true);
      expect(output?.validate({ status: "missing", mediaType: "image/png" })).toBe(true);
      expect(output?.validate({ status: "available", mediaType: "image/png" })).toBe(true);
      expect(output?.validate({ status: "gone" })).toBe(false);
    });
  });
});
