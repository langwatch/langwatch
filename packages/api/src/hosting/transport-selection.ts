import {
  browserBundleDefaults,
  restSurfaceDefaults,
  trpcSurfaceDefaults,
  type SurfaceDefaultsOptions,
} from "../policy/defaults.ts";
import type { SecurityHeaders } from "../policy/security-headers.ts";
import type { DocumentAccess } from "./browser-bundle.ts";
import type { FramedDocumentSelection } from "./framed-document.ts";

export type SurfacePolicy = (defaults: SecurityHeaders) => SecurityHeaders;
export type BundleSelection = Readonly<{
  security: SecurityHeaders;
  authorizeDocument?: DocumentAccess;
}>;

/** Selects surfaces and policy; dependency resolution and routing stay inside the host. */
export class TransportSelection {
  static create(defaults: SurfaceDefaultsOptions = {}): TransportSelection {
    return new TransportSelection(defaults);
  }

  #trpc: SecurityHeaders | undefined;
  #rest: SecurityHeaders | undefined;
  #bundle: BundleSelection | false | undefined;
  readonly #documents: FramedDocumentSelection[] = [];

  private constructor(readonly defaults: SurfaceDefaultsOptions) {}

  trpc(policy: SurfacePolicy = (defaults) => defaults): this {
    this.#trpc = policy(trpcSurfaceDefaults(this.defaults));

    return this;
  }

  rest(policy: SurfacePolicy = (defaults) => defaults): this {
    this.#rest = policy(restSurfaceDefaults(this.defaults));

    return this;
  }

  browserBundle(policy: SurfacePolicy | false = (defaults) => defaults): this {
    this.#bundle =
      policy === false ? false : { security: policy(browserBundleDefaults(this.defaults)) };

    return this;
  }

  withDocumentAccess(authorizeDocument: DocumentAccess): this {
    if (!this.#bundle)
      throw new Error("Select the browser bundle before its document access policy.");

    this.#bundle = { ...this.#bundle, authorizeDocument };

    return this;
  }

  /** A module-built document served on the app origin under the frame policy, beside the bundle. */
  framedDocument(selection: FramedDocumentSelection): this {
    if (!this.#bundle)
      throw new Error("Select the browser bundle before a framed document; it answers beside it.");
    if (this.#documents.some((document) => document.path === selection.path))
      throw new Error(`Two framed documents claim "${selection.path}".`);

    this.#documents.push(selection);

    return this;
  }

  get selected() {
    if (this.#bundle === undefined)
      throw new Error("surface.browserBundle must be selected or explicitly disabled.");

    return {
      trpc: this.#trpc,
      rest: this.#rest,
      bundle: this.#bundle,
      documents: [...this.#documents],
    };
  }
}
