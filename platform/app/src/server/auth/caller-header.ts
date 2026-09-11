/**
 * The canonical header this application states its resolved caller on.
 *
 * `x-forwarded-for` rather than a header of our own, because the consumer is
 * Better Auth and this is the one header it can be told to read. It is also the
 * chain form, so a value here is indistinguishable in shape from the one a
 * proxy would have written - which is the point: nothing downstream needs to
 * know the answer was re-decided.
 */
const CALLER_HEADER = "x-forwarded-for";

/**
 * The same request, carrying the caller the application resolved.
 *
 * Better Auth runs its own limits over `/api/auth/*` - sign-in, password reset,
 * passkey registration, the second factor - and works out who to count from the
 * request alone, because a fetch `Request` is all a handler is given and a
 * `Request` carries nothing about the connection that delivered it. Left to
 * itself it reads a forwarding header, which is the caller's to write.
 *
 * The application already answers "who is calling" once, from the socket peer,
 * reading a forwarding header only when that peer is one of the deployment's
 * own hops. This restates that answer so Better Auth's resolution reproduces it
 * instead of competing with it: one caller identity, decided in one place, with
 * no route from a caller's own header to a rate-limit bucket.
 *
 * A caller that could not be resolved leaves the header off rather than
 * guessing. Better Auth counts an unresolvable caller in a single shared
 * bucket, which is a coarse limit rather than an absent one.
 *
 * Rebuilt rather than mutated because the header guard on an adapter's
 * `Request` is not ours to rely on. The body rides along untouched.
 */
export function requestStatingCaller({
  request,
  caller,
}: {
  request: Request;
  caller: string | undefined;
}): Request {
  const headers = new Headers(request.headers);

  if (caller) headers.set(CALLER_HEADER, caller);
  else headers.delete(CALLER_HEADER);

  return new Request(request, { headers });
}
