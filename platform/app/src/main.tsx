import { UiRuntime } from "@langwatch/ui";
import { LegacyUiShellAdapter } from "./runtime/ui/legacy-ui-shell.adapter";
import "nprogress/nprogress.css";
import "./styles/globals.scss";

const ui = UiRuntime.create({
  document,
  shell: LegacyUiShellAdapter.create(),
});

ui.start();
