/** The basic-auth header for the Twilio REST API; the token is base64-encoded, never logged. */
export function twilioBasicAuthHeader({
  accountSid,
  authToken,
}: {
  accountSid: string;
  authToken: string;
}): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}
