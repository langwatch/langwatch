import { useEffect, useState } from "react";

// Press ↑ ↑ ↓ ↓ ← → ← → while the sequence view is mounted to swap every
// stick-figure actor head for an image. The image URL is a placeholder for
// now — swap `EASTER_EGG_IMAGE_URL` for a real photo when ready. Pressing
// the sequence again toggles it off.
const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
] as const;

// Placeholder avatar — a tasteful gradient SVG. Drop in a real photo URL
// (or imported asset) here when you want to surprise someone.
export const EASTER_EGG_IMAGE_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#A855F7"/>
          <stop offset="100%" stop-color="#3B82F6"/>
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#g)"/>
      <circle cx="24" cy="28" r="3" fill="#fff"/>
      <circle cx="40" cy="28" r="3" fill="#fff"/>
      <path d="M22 40 Q32 48 42 40" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  );

/**
 * Listens at the document level for the Konami arrow sequence and toggles a
 * boolean. The user can be focused anywhere inside the drawer when triggering
 * it. Non-arrow keys reset the buffer.
 */
export function useKonamiEasterEgg(): boolean {
  const [easterEgg, setEasterEgg] = useState(false);

  useEffect(() => {
    const buffer: string[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (
        !KONAMI_SEQUENCE.includes(e.key as (typeof KONAMI_SEQUENCE)[number])
      ) {
        buffer.length = 0;
        return;
      }
      buffer.push(e.key);
      if (buffer.length > KONAMI_SEQUENCE.length) buffer.shift();
      if (
        buffer.length === KONAMI_SEQUENCE.length &&
        buffer.every((k, i) => k === KONAMI_SEQUENCE[i])
      ) {
        setEasterEgg((prev) => !prev);
        buffer.length = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return easterEgg;
}
