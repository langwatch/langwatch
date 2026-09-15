/**
 * What this application does when any mutation fails on a licence limit or a
 * Lite Member restriction: the licensing feature owns that answer, so the
 * upgrade modal opens once rather than per screen.
 */

import { reportLicenseFailure } from "@langwatch/enterprise-licensing-web/surfaces/license-error-interceptor";
import type { UiFailureInterceptor } from "../../../behavior/ui-feature";

export const licensingFailures: UiFailureInterceptor = (error) => reportLicenseFailure(error);
