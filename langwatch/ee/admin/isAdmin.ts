export const isAdmin = (user: { email?: string | null }) => {
  if (!user) return false;
  const adminEmails = process.env.ADMIN_EMAILS;
  return (
    adminEmails && user.email && adminEmails.split(",").includes(user.email)
  );
};
