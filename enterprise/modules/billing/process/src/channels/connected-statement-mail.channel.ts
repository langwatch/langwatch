// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ConnectedStatement } from "../services/connected-monthly-statement.service.ts";

/**
 * The monthly statement mail, as billing hands it over. Envelope, template and
 * sender belong to the mail composition, hence a channel, not a service.
 */
export abstract class ConnectedStatementMailChannel {
  abstract send(statement: ConnectedStatement): Promise<void>;
}
