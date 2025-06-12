import { withController } from "~/utils/withControllerHOC";
import { SetRunHistorySidebarComponent } from "./SetRunHistorySidebarComponent";
import { useSetRunHistorySidebarController } from "./useSetRunHistorySidebarController";

export const SetRunHistorySidebar = withController(
  SetRunHistorySidebarComponent,
  useSetRunHistorySidebarController
);
