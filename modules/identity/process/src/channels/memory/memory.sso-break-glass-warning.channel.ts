import { SsoBreakGlassWarningChannel } from "../sso-break-glass-warning.channel.ts";

/** Warnings in memory: each one sent is recorded for a test to read back. */
export class MemorySsoBreakGlassWarningChannel extends SsoBreakGlassWarningChannel {
  readonly sent: { bindingId: string; daysRemaining: number }[] = [];

  private constructor() {
    super();
  }

  static create(): MemorySsoBreakGlassWarningChannel {
    return new MemorySsoBreakGlassWarningChannel();
  }

  async warn({
    binding,
    daysRemaining,
  }: Parameters<SsoBreakGlassWarningChannel["warn"]>[0]): Promise<void> {
    this.sent.push({ bindingId: binding.bindingId, daysRemaining });
  }
}
