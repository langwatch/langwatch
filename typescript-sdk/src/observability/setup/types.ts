import { Logger } from "../../logger";

export interface ObservabilityConfig {
  logger: Logger;
  suppressInputCapture?: boolean;
  suppressOutputCapture?: boolean;
}
