// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Warn threshold for budget crossing events, as a percentage of the
 * limit. Mirrors the gateway checker's SoftWarnPercent and the
 * control-plane soft-warn threshold so the response header, the
 * dashboard, and the webhook family all fire at the same point.
 */
export const SoftWarnPercent = 80;
