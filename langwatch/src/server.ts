// Must be first: loads dotenv + env-dependent setup before `./start` evaluates.
// ES module imports run in declaration order, so side effects here land before
// `./start` pulls in modules that read process.env at load time.
import "./bootstrap";
import { startApp } from "./start";

void startApp();
