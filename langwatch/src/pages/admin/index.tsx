import type { NextPage } from "next";
import ClientAdminWrapper from "../../../ee/admin/ClientAdminWrapper";

export { getServerSideProps } from "../../../ee/admin/adminGetServerSideProps";

const AdminPage: NextPage = () => <ClientAdminWrapper />;

export default AdminPage;
