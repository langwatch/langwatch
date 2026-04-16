import AdminApp from "./AdminApp";

interface ClientAdminWrapperProps {
  /** Forwarded to <Admin basename="..."> — see AdminApp. */
  basename?: string;
}

const ClientAdminWrapper = ({ basename }: ClientAdminWrapperProps = {}) => {
  // Prevent SSR
  if (typeof window === "undefined") {
    return null
  }

  return <AdminApp basename={basename} />;
};

export default ClientAdminWrapper;
