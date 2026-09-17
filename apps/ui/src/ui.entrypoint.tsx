// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { startUi } from "./ui.main";

import "nprogress/nprogress.css";
import "./styles/globals.scss";

void startUi();
