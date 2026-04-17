import AdminApp from "./AdminApp";

const ClientAdminWrapper = () => {
  // Prevent SSR
  if (typeof window === "undefined") {
    return null
  }

  return <AdminApp />;
};

export default ClientAdminWrapper;
