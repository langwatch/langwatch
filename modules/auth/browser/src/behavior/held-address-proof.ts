import { nowInstant } from "@langwatch/time";
import { z } from "zod";

/**
 * The confirmed address and the single-use proof its link returned, held for this tab only,
 * so a reload of the "Create your account" step stays on it. Storage can be missing or
 * refuse writes (private windows, blocked site data): every access tolerates that.
 */
const KEY = "langwatch.auth.signUpAddressProof";

/** Matches the server's proof lifetime; an older proof is refused anyway. */
export const HELD_ADDRESS_PROOF_MAX_AGE_MS = 30 * 60 * 1000;

const heldAddressProofSchema = z.object({
  email: z.string().min(1),
  addressProof: z.string().min(1),
  heldAt: z.number(),
});

export type HeldAddressProof = Pick<
  z.infer<typeof heldAddressProofSchema>,
  "email" | "addressProof"
>;

export function holdAddressProof({
  email,
  addressProof,
  now = nowInstant().epochMilliseconds,
}: HeldAddressProof & { now?: number }): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email, addressProof, heldAt: now }));
  } catch {
    // Not held: a reload returns to the address step, as without storage.
  }
}

/** The proof this tab holds, or `null` when there is none, it is unreadable or it expired. */
export function readHeldAddressProof({
  now = nowInstant().epochMilliseconds,
}: { now?: number } = {}): HeldAddressProof | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const held = heldAddressProofSchema.safeParse(JSON.parse(raw));
    if (!held.success || now - held.data.heldAt > HELD_ADDRESS_PROOF_MAX_AGE_MS) {
      forgetHeldAddressProof();
      return null;
    }
    return { email: held.data.email, addressProof: held.data.addressProof };
  } catch {
    return null;
  }
}

/** Whether this document was loaded by a reload; a fresh visit to sign-up starts over. */
export function arrivedByReload(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

/** The held proof on a reload; on any other arrival it is dropped and `null` returned. */
export function takeHeldAddressProofOnReload(): HeldAddressProof | null {
  if (arrivedByReload()) return readHeldAddressProof();
  forgetHeldAddressProof();
  return null;
}

export function forgetHeldAddressProof(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing could be held where storage is refused.
  }
}
