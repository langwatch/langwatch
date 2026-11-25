import { NotFoundError } from "@langwatch/handled-error";

/** No open seat request with this id in this organization. */
export class SeatRequestNotFoundError extends NotFoundError {
  declare readonly code: "seat_request_not_found";

  constructor(seatRequestId: string) {
    super(
      "seat_request_not_found",
      { resource: "Seat request", id: seatRequestId },
      { meta: { seatRequestId } },
    );
    this.name = "SeatRequestNotFoundError";
  }
}
