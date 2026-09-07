/**
 * Per-project admission gate for voice runs.
 *
 * A voice run holds an ElevenLabs socket for the length of a call, so a project
 * may only run VOICE_RUNS_MAX_CONCURRENT of them at once; the rest wait in the
 * pool's queue with the ordinary queued status. This is a pure in-memory
 * semaphore keyed `voice:<projectId>`, consulted by the pool when it decides
 * whether a job may start. Text runs never touch it.
 */

export class VoiceConcurrencyGate {
  private readonly max: number;
  private readonly active = new Map<string, number>();

  constructor({ max }: { max: number }) {
    this.max = max;
  }

  private key(projectId: string): string {
    return `voice:${projectId}`;
  }

  /** How many voice runs the project has in flight right now. */
  activeCount(projectId: string): number {
    return this.active.get(this.key(projectId)) ?? 0;
  }

  /** Whether another voice run may start for this project. */
  canAcquire(projectId: string): boolean {
    return this.activeCount(projectId) < this.max;
  }

  /** Record a voice run starting. Call only after {@link canAcquire}. */
  acquire(projectId: string): void {
    const key = this.key(projectId);
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
  }

  /** Record a voice run finishing; the map entry is dropped at zero. */
  release(projectId: string): void {
    const key = this.key(projectId);
    const next = (this.active.get(key) ?? 0) - 1;
    if (next <= 0) {
      this.active.delete(key);
    } else {
      this.active.set(key, next);
    }
  }
}
