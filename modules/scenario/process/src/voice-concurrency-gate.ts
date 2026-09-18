/**
 * Per-project admission gate for voice runs (ElevenLabs socket per call).
 * In-memory semaphore `voice:<projectId>`, limits concurrent runs; text runs never touch it.
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
