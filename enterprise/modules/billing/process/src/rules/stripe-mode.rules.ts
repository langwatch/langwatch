/** A Stripe secret or restricted key names its mode in its prefix: `sk_test_…`, `rk_test_…`. */
export function isStripeTestModeKey({ secretKey }: { secretKey: string | undefined }): boolean {
  return /^(sk|rk)_test_/.test(secretKey?.trim() ?? "");
}
