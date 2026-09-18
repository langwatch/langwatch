// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { startApi } from "./api.main.ts";

void startApi();
