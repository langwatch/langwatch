import { HandledError } from "@langwatch/handled-error";

/** The demo hotel bot turns away about half its calls on purpose, so the project shows failures. */
export class HotelBotDeclinedError extends HandledError {
  declare readonly code: "demo_bot_declined";

  constructor() {
    super("demo_bot_declined", "The demo bot turned this call away; try again", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "HotelBotDeclinedError";
  }
}
