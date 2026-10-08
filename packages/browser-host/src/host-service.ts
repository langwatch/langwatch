/**
 * A service browser-host declares and exactly one installed module provides with
 * `.provides(Service, { load })`; `createUi` resolves it. ARCHITECTURE.md §10.1.
 */

/** What an installation and the runtime keep of a host service, whatever its source. */
export type HostServiceIdentity = Readonly<{ name: string }>;

/** The source's type rides on the service, so `.provides` checks the chunk against it. */
export class HostService<Source> {
  declare private readonly source: (value: Source) => Source;

  constructor(readonly name: string) {
    Object.freeze(this);
  }
}

export function hostService<Source>(name: string): HostService<Source> {
  return new HostService<Source>(name);
}
