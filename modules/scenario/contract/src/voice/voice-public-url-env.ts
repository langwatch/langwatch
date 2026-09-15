/**
 * The env var a voice worker uses to thread WHY it has no public media URL —
 * its cloudflared tunnel mint failed at boot — from the worker process down to
 * the scenario child, so the child's eventual phone-run error can name the real
 * cause (e.g. "spawn cloudflared ENOENT") instead of a generic "no public media
 * URL".
 *
 * A leaf with NO imports on purpose: the worker boot that writes it
 * (`startWorkers.ts`), the child-env forwarder (`child-environment.ts`), and the
 * phone transport that reads it (`phone.transport.ts`) all import this name,
 * and only a dependency-free leaf can be shared across the parent/child
 * boundary without dragging a heavy graph through `child-environment.ts`.
 */
export const VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV =
  "VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON";
