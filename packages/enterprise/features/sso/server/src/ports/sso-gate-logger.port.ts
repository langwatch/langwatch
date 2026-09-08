// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Where the gate says what it decided. An operator whose single sign-on is off
 * reads these lines to learn why, so the process supplies its own logger.
 */
export abstract class SsoGateLoggerPort {
  abstract info(context: object, message: string): void;
  abstract warn(context: object, message: string): void;
}
