/**
 * How many tokens a model would charge for a piece of text.
 *
 * It is a port because the answer comes from a vendor encoding table that a
 * feature package must not carry: the application resolves it with `tiktoken`
 * plus a BPE file that is either on disk or fetched over the network, and a
 * process composed from packages supplies the same capability without this
 * package naming the library, the download or the cache.
 *
 * `undefined` is the deliberate answer for "cannot count", not an error. The
 * estimator's whole contract is that a span without usage attributes is left
 * exactly as it arrived rather than stamped with a guess, so an unknown
 * encoding, a failed encode and an empty text all resolve to the same nothing.
 * The application spells this `countTokens`; the `try` prefix is what
 * `fallible-result-naming` requires of a capability that answers absence.
 */
export abstract class TraceTokenCounterPort {
  abstract tryCountTokens(model: string, text: string | undefined): Promise<number | undefined>;
}
