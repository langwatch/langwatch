import type { ModuleApiToken } from "@langwatch/module";

/** What a boot calls with each peer's token and implementation, to answer that token. */
export type PeerBinder = <Api>(token: ModuleApiToken<Api>, instance: Api) => void;

/**
 * A stand-in for a peer's `*Api` that an installation test hands a boot in place of
 * installing the peer's module. Only test files may build one (package-boundaries).
 */
export class TestPeer {
  constructor(readonly bind: (provide: PeerBinder) => void) {}
}

/** Binds an implementation of one `*Api` to its token; the boot answers that token with it. */
export function testPeer<Api>({
  token,
  instance,
}: {
  token: ModuleApiToken<Api>;
  instance: Api;
}): TestPeer {
  return new TestPeer((provide) => provide(token, instance));
}
