import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

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

/** A member asked for a full seat they already hold: there is nothing for an admin to approve. */
export class SeatRequestFullMemberError extends HandledError {
  declare readonly code: "seat_request_full_member";

  constructor() {
    super("seat_request_full_member", "You already hold a full member seat", {
      httpStatus: 409,
      ...remediation("seat_request_full_member"),
    });
    this.name = "SeatRequestFullMemberError";
  }
}
