// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ProviderSignInError } from "@langwatch/enterprise-governance-contract";

import type { ProviderSignInChannel } from "../provider-sign-in.channel.ts";

type SignInAnswer = { token: string } | { error: ProviderSignInError | Error };

/** Sign-in in memory: a seeded address answers as seeded; otherwise a pasted token or not_configured. */
export class MemoryProviderSignInChannel implements ProviderSignInChannel {
  readonly asked: string[] = [];
  private readonly answers = new Map<string, SignInAnswer>();

  private constructor() {}

  static create(): MemoryProviderSignInChannel {
    return new MemoryProviderSignInChannel();
  }

  seed({ url, answer }: { url: string; answer: SignInAnswer }): void {
    this.answers.set(url, answer);
  }

  async getWorkspaceToken({
    credentials,
    workspaceUrl,
  }: {
    credentials: Record<string, string> | undefined;
    workspaceUrl: string;
  }): Promise<string> {
    return this.answer({ url: workspaceUrl, credentials });
  }

  async getEnvironmentToken({
    credentials,
    environmentUrl,
  }: {
    credentials: Record<string, string> | undefined;
    environmentUrl: string;
  }): Promise<string> {
    return this.answer({ url: environmentUrl, credentials });
  }

  private answer({
    url,
    credentials,
  }: {
    url: string;
    credentials: Record<string, string> | undefined;
  }): string {
    this.asked.push(url);
    const seeded = this.answers.get(url);
    if (seeded && "error" in seeded) throw seeded.error;
    if (seeded) return seeded.token;
    const pasted = credentials?.token;
    if (pasted) return pasted;
    throw new ProviderSignInError("no credential this provider can sign in with", {
      reason: "not_configured",
    });
  }
}
