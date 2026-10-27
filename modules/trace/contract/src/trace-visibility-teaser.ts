/**
 * Teaser truncation rule: keep the first max(TEASER_MIN_CHARS, min(TEASER_MAX_CHARS, ceil(len *
 * TEASER_FRACTION))) characters of each content field. The floor keeps tiny traces legible as
 * teasers; the cap stops large payloads from leaking meaningful content.
 */
export const TEASER_FRACTION = 0.1;
export const TEASER_MIN_CHARS = 50;
export const TEASER_MAX_CHARS = 300;

/**
 * Truncation marker appended to every teased value — it ships in the API
 * payload itself so every consumer (UI, SDK, exports, REST) sees "there is
 * more data here" without client-side decoration.
 */
export const TEASER_ELLIPSIS = " …";

/** One content field cut to its teaser, marked so every consumer sees there is more. */
export const teaserOf = (text: string): string => {
  const keep = Math.max(
    TEASER_MIN_CHARS,
    Math.min(TEASER_MAX_CHARS, Math.ceil(text.length * TEASER_FRACTION)),
  );

  return text.length <= keep ? text : text.slice(0, keep) + TEASER_ELLIPSIS;
};
