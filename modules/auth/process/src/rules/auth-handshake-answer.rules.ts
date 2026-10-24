/** What the `/api/auth/*` handshake answers, as data; the transport door writes it.
 * - `refused-origin`: a call from another origin, refused before Better Auth sees it.
 * - `engine`: Better Auth's own response, untouched, or with its `location` replaced when set.
 * - `sign-in-failed`: a server error on a sign-in callback, sent to the error screen instead.
 */
export type AuthHandshakeAnswer =
  | Readonly<{ kind: "refused-origin" }>
  | Readonly<{ kind: "engine"; response: Response; location?: string }>
  | Readonly<{ kind: "sign-in-failed"; location: string }>;
