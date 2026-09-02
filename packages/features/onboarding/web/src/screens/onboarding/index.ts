/**
 * The onboarding family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for each
 * page is a LOADER rather than a component: between them these five screens drag
 * the whole observability codegen — a Shiki-backed code block and ~30 snippets
 * read as raw text — and none of that belongs in the chunk a reader downloads
 * for the rest of the application.
 *
 * FIVE ADDRESSES:
 *
 *   `/onboarding`                → onboarding, a redirect-only screen: a reader
 *                                  who already has a project is sent to it.
 *   `/onboarding/welcome`        → welcome, the organization the reader creates.
 *   `/onboarding/product`        → product, the flavour flow after that.
 *   `/onboarding/:team/project`  → project, the first project's form.
 *   `/:project/setup`            → setup, the integration guide a project shows
 *                                  until its first trace arrives. It is inside
 *                                  the application chrome; the other four are
 *                                  not, because there is no project to switch
 *                                  between yet.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC Provider
 * this package's hooks run on, and the host port — the organization graph, the
 * session, the address, one feature flag, sign-out, the two notices, the
 * clipboard, the reduced-motion preference, and `revealProjectApiKey()`, which
 * is the setup guide's base key asked for by name rather than carried on the
 * scope reading. The DEPLOYMENT is not on it: `behavior/use-public-env` decodes
 * the public-config meta tag itself, because the modules that read it are also
 * mounted by a package with no onboarding host above them.
 */

import type { ComponentType } from "react";

export type OnboardingScreenLoader = () => Promise<{ default: ComponentType }>;

export const onboardingScreens = {
  onboarding: () => import("./onboarding.screen"),
  welcome: () => import("./welcome.screen"),
  product: () => import("./product.screen"),
  project: () => import("./project.screen"),
  setup: () => import("./setup.screen"),
} as const satisfies Record<string, OnboardingScreenLoader>;

export type OnboardingScreenName = keyof typeof onboardingScreens;

export { onboardingApi } from "../../behavior/onboarding-api";
export {
  OnboardingHostPort,
  OnboardingHostProvider,
  type OnboardingActor,
  type OnboardingFailureNotice,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingProject,
  type OnboardingRouteReading,
  type OnboardingScope,
  type OnboardingSessionStatus,
  type OnboardingSuccessNotice,
  type OnboardingTeam,
} from "../../model/onboarding-host";
