export const isAdmin = (user: { email?: string | null; }) => {
  const adminEmails = process.env.ADMIN_EMAILS;
  return adminEmails && user.email && adminEmails.split(",").includes(user.email);
};
