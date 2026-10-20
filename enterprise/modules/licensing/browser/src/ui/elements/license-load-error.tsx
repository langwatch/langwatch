import { BannerAction, Banner } from "@langwatch/design-system/banner";

/**
 * Shown when the license status could not be fetched. Distinct from having no
 * license: we do not know either way here, so it offers a retry rather than an
 * activation form.
 */
export function LicenseLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Banner
      status="error"
      title="Unable to load license"
      action={<BannerAction onClick={onRetry}>Retry</BannerAction>}
    >
      Your license status could not be retrieved. Try again, or contact support if the problem
      persists.
    </Banner>
  );
}
