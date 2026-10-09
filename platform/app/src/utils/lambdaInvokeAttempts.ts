/**
 * How many times an nlpgo Lambda invoke may be attempted.
 *
 * One number, read by both sides of the invoke: the client the studio path
 * builds (`optimization_studio/server/lambda`) hands it to the AWS SDK, and
 * `lambdaFetch` uses it as the ceiling for its own retry loop, which retries
 * a far narrower set of failures. They have to agree, so they share this.
 *
 * It has a module of its own rather than living next to either caller,
 * because a test mocking one of them must not change the other's allowance.
 */

// The SDK default is 3 attempts for retryable errors (including
// TooManyRequestsException, which surfaces as "Rate Exceeded."). When the
// per-project Lambda fleet is cold-starting under a fresh image, a transient
// ConcurrentExecutions burst can put all 3 attempts inside the saturation.
// 6 rides out a 30 to 60 second burst without surfacing the error.
export const LAMBDA_CLIENT_MAX_ATTEMPTS = 6;
