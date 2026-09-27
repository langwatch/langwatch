import { describe, expect, it } from "vitest";

import {
  GUEST_QUERIES,
  guestQueryFor,
  hotelBotDeclines,
  hotelBotRunsRestaurantSearch,
  restaurantReviewCount,
} from "../hotel-bot.rules.ts";

describe("hotel bot rules", () => {
  it("declines every even roll of ten", () => {
    expect([0, 0.1, 0.2, 0.35, 0.99].map(hotelBotDeclines)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it("runs the restaurant search on an even roll", () => {
    expect(hotelBotRunsRestaurantSearch(0.4)).toBe(true);
    expect(hotelBotRunsRestaurantSearch(0.5)).toBe(false);
  });

  it("retrieves two to six reviews", () => {
    expect(restaurantReviewCount(0)).toBe(2);
    expect(restaurantReviewCount(0.999)).toBe(6);
  });

  it("picks a guest query across the whole list", () => {
    expect(guestQueryFor(0)).toBe(GUEST_QUERIES[0]);
    expect(guestQueryFor(0.999)).toBe(GUEST_QUERIES[GUEST_QUERIES.length - 1]);
  });
});
