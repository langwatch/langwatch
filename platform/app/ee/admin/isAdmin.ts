export const isAdmin = (user: { email?: string | null }) => {
  if (!user) return false;
  const adminEmails = process.env.ADMIN_EMAILS;
  if (!adminEmails || !user.email) return false;
  const normalizedEmail = user.email.toLowerCase().trim();
  return adminEmails
    .split(",")
    .some((e) => e.trim().toLowerCase() === normalizedEmail);
};
