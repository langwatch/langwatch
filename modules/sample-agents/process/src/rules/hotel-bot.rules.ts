/** The model main's demo bot has always called. */
export const HOTEL_BOT_MODEL = "gpt-3.5-turbo";

export const GUEST_QUERIES = [
  "Room Assistance",
  "Dining Recommendations and Reservations",
  "Transportation Services",
  "Local Area Information",
  "Special Requests",
  "Technical Support",
  "Housekeeping Services",
  "Billing and Check-out Assistance",
] as const;

export const HOTEL_SYSTEM_PROMPT =
  "Imagine you're in a bustling hotel lobby, serving as the knowledgeable and friendly concierge. You're the go-to person for guests seeking recommendations, assistance with reservations, or information about local attractions. How would you welcome guests and ensure their stay is memorable? Think about how you'd provide personalized recommendations, handle inquiries efficiently, and maintain a professional yet friendly demeanor.";

export const RAG_SYSTEM_PROMPT = "You are a restaurant expert knowing the best around town.";

export const RAG_USER_INPUT = "What are the 5 best restaurants in the area?";

export const RESTAURANT_REVIEW_PROMPT =
  "Invent a restaurant name and a short google maps review of it";

export const GUEST_REPLY_PROMPT =
  "Based on the information provided, how would a guest respond to the concierge? Write as if you are the guest.";

export function initialGuestPrompt(query: string): string {
  return `Using a support request such as.. ${query}. Pretend you are the guest! No explanation needed. Don't put quotes around your message. Write as if you are the guest. Max 2 sentences.`;
}

/** A roll of 0-9 from a `[0, 1)` draw, as main's `Math.floor(Math.random() * 10)`. */
export function rollOfTen(draw: number): number {
  return Math.floor(draw * 10);
}

/** Main turns away every even roll, so about half of all calls are refused. */
export function hotelBotDeclines(draw: number): boolean {
  return rollOfTen(draw) % 2 === 0;
}

/** An even roll runs the restaurant (RAG) conversation; an odd one the two-turn concierge chat. */
export function hotelBotRunsRestaurantSearch(draw: number): boolean {
  return rollOfTen(draw) % 2 === 0;
}

/** How many restaurant reviews the RAG span retrieves: two to six. */
export function restaurantReviewCount(draw: number): number {
  return 2 + Math.floor(draw * 5);
}

export function guestQueryFor(draw: number): string {
  return GUEST_QUERIES[Math.floor(draw * GUEST_QUERIES.length)] ?? GUEST_QUERIES[0];
}
