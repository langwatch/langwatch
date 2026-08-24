/** The public unsubscribe view masks both the address and its local-part
 * length. This pure contract helper is shared by server and web surfaces. */
export function maskEmail(email: string): string {
	const at = email.indexOf("@");
	return at <= 0 ? "***" : `${email[0]}***${email.slice(at)}`;
}
