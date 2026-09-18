// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import { startWorker } from "./worker.main.ts";

void startWorker();
