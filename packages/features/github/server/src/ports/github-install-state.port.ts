import type { GithubInstallStatePayload } from "@langwatch/github-contract";

export abstract class GithubInstallStatePort {
  abstract getTtlMs(): number;
  abstract registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;
  abstract tryConsumeNonce(nonce: string): Promise<boolean | null>;
  abstract sign(payload: GithubInstallStatePayload): string;
  abstract tryVerify(token: string | null | undefined): GithubInstallStatePayload | null;
}
