/**
 * The takeover ends with a full navigation: the product's shell boots fresh
 * on the landing page, with the organization and the project it now has.
 */
export function navigateTo(href: string): void {
  window.location.href = href;
}
