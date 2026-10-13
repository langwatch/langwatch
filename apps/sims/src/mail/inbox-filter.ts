import type { Summary } from "./mail-api.ts";

/** Search over sender, recipients and subject, then the one chosen recipient. */
export const filterMessages = ({
  messages,
  query,
  recipient,
}: {
  messages: Summary[];
  query: string;
  recipient: string;
}) => {
  const needle = query.trim().toLowerCase();
  return messages.filter(
    (message) =>
      (recipient === "" || message.to.some((address) => address.toLowerCase() === recipient)) &&
      [message.from, ...message.to, message.subject].join(" ").toLowerCase().includes(needle),
  );
};

/** Every recipient address, lower-cased and sorted, counting each message once. */
export const recipientCounts = ({ messages }: { messages: Summary[] }) => {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const address of new Set(message.to.map((value) => value.toLowerCase()))) {
      counts.set(address, (counts.get(address) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([address, count]) => ({ address, count }))
    .toSorted((a, b) => a.address.localeCompare(b.address));
};
