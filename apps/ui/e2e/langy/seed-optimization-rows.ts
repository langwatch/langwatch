/**
 * The fixture rows the prompt-optimization suites seed their workbench with.
 *
 * The baseline prompt deliberately knows none of Brightcart's policy facts
 * while the golden answers state them, so roughly the last third of the rows
 * fail an answer-match evaluator until the prompt learns the policies. That is
 * the improvement the loop scenarios expect Langy to find.
 */

export interface SeedRow {
  input: string;
  expected: string;
}

/** Rows a support bot for the Brightcart webshop would really get. */
export const FREE_TEXT_ROWS: SeedRow[] = [
  {
    input: "hey where is my order #4521 its been 2 weeks",
    expected:
      "Apologize for the wait, ask for the order confirmation email, and share the tracking link from it. Orders ship within 2 business days, so 2 weeks means the carrier lost it and we reship for free.",
  },
  {
    input: "can i return these shoes? they don't fit",
    expected:
      "Yes. Returns are free within 30 days of delivery. Start from the Returns page with the order number and a prepaid label is emailed.",
  },
  {
    input: "refund pls, package arrived smashed",
    expected:
      "Apologize, no return needed for damaged items: a photo of the damage is enough, and the refund lands in 5 to 10 business days on the original payment method.",
  },
  {
    input: "do you ship to portugal??",
    expected:
      "Yes, Brightcart ships to all EU countries. Shipping is free over 50 euros, otherwise 4.99.",
  },
  {
    input: "your checkout keeps erroring when i enter my card",
    expected:
      "Apologize, suggest retrying with another browser or the saved-card option, and offer to send a payment link by email if it still fails.",
  },
  {
    input: "how long do refunds take",
    expected:
      "Refunds take 5 to 10 business days and always go back to the original payment method.",
  },
  {
    input: "i ordered the blue one but got the black one",
    expected:
      "Apologize for the mixup. We ship the correct color right away with free express shipping and email a prepaid label for the wrong item.",
  },
  {
    input: "is there a student discount",
    expected:
      "No student discount, but the newsletter gives 10 percent off the first order.",
  },
  {
    input: "cancel my order NOW, i ordered by mistake",
    expected:
      "Orders can be cancelled within 1 hour of placing them from the account page. After that they ship, and the free 30-day return covers it.",
  },
  {
    input: "what's your phone number, i hate email",
    expected:
      "Support is chat and email only, no phone line. Chat answers within a few minutes on business days.",
  },
  {
    input: "the discount code SUMMER10 doesn't work",
    expected:
      "SUMMER10 expired at the end of summer. The newsletter code or current promotions on the homepage still apply, and codes never stack.",
  },
  {
    input: "do i pay customs on my order to switzerland",
    expected:
      "Switzerland is outside the EU, so customs fees can apply and are the customer's responsibility. EU orders never pay customs.",
  },
  {
    input: "my tracking says delivered but nothing arrived",
    expected:
      "Ask them to check with neighbors and the mail room first; if nothing shows up within 2 days we reship for free or refund, their choice.",
  },
  {
    input: "can i change the delivery address? i moved",
    expected:
      "The address can be changed until the order ships. After shipping, the carrier's redirect service is the only option, and support can request it.",
  },
  {
    input: "why was i charged twice???",
    expected:
      "One of the two is a pending authorization that the bank drops within 3 business days; only one charge settles. If both settle, support refunds the duplicate immediately.",
  },
  {
    input: "loyal customer here, 6 orders this year. any perks?",
    expected:
      "Thank them; after 5 orders the account is automatically upgraded to free express shipping on every order.",
  },
  {
    input: "the sweater shrank after one wash, this is not ok",
    expected:
      "Apologize, quality issues are covered for 90 days: a photo is enough for a replacement or refund, their choice.",
  },
  {
    input: "do you have gift wrapping",
    expected:
      "Yes, gift wrapping is 2.99 per item and can be added on the cart page, with a free personal note.",
  },
  {
    input: "i want to buy 40 units for my company, bulk price?",
    expected:
      "Orders over 20 units go through business sales: share the business email from the Contact page and they quote within one business day.",
  },
  {
    input: "u guys are a scam, im calling my bank",
    expected:
      "Stay calm and apologize, ask for the order number to fix the actual problem, and never argue with the chargeback threat.",
  },
];

/** The same shop, as a classification task: one short label per email. */
export const LABEL_ROWS: SeedRow[] = [
  { input: "where is my package, ordered last monday", expected: "shipping" },
  { input: "these jeans don't fit, want my money back", expected: "refund" },
  { input: "checkout page crashes on my phone", expected: "technical" },
  { input: "do you deliver to austria", expected: "shipping" },
  { input: "got charged twice for one order", expected: "billing" },
  { input: "my discount code is not working", expected: "billing" },
  { input: "arrived broken, glass everywhere", expected: "refund" },
  { input: "how do i reset my password", expected: "technical" },
  { input: "wrong size arrived, need an exchange", expected: "exchange" },
  { input: "is the winter coat coming back in stock", expected: "product" },
  { input: "cancel order 8841 please", expected: "cancellation" },
  { input: "does the blender come with a warranty", expected: "product" },
  { input: "package says delivered, mailbox empty", expected: "shipping" },
  { input: "i want a different color instead", expected: "exchange" },
  { input: "why is there an extra 4.99 on my invoice", expected: "billing" },
  { input: "app logs me out every time", expected: "technical" },
  { input: "returning a gift without a receipt", expected: "refund" },
  { input: "when will my backorder ship", expected: "shipping" },
  { input: "the fabric feels nothing like the photos", expected: "refund" },
  {
    input: "can i add an item to an order i just placed",
    expected: "cancellation",
  },
];

export const SUPPORT_PROMPT =
  "You are the customer support assistant for Brightcart, a European webshop for clothing and home goods. Reply briefly, politely and helpfully to customer emails.";

export const CLASSIFIER_PROMPT =
  "You classify Brightcart customer support emails into a single category and answer with only the category word.";
