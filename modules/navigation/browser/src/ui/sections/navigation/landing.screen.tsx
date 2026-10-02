import { useLandingRedirect } from "../../../behavior/use-landing-redirect.ts";

/**
 * Landing page (/): picks right home and replaces address, drawing nothing
 * meanwhile. Picking logic in useLandingRedirect. Moved from platform/app.
 */
export default function LandingScreen() {
  useLandingRedirect();

  return null;
}
