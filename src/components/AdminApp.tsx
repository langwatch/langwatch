"use client"; // remove this line if you choose Pages Router
import {
  Admin,
  Resource,
  ListGuesser,
  EditGuesser,
  Datagrid,
  List,
  DateField,
  TextField,
  EditButton,
  Button,
  FunctionField,
  TextInput,
} from "react-admin";
import { dataProvider } from "ra-data-simple-prisma";
import type { User } from "@prisma/client";
import { useState } from "react";

const AdminApp = () => {
  const [loadingImpersonation, setLoadingImpersonation] = useState<
    string | undefined
  >();
  const handleImpersonation = async (user: User) => {
    setLoadingImpersonation(user.id);
    const response = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userIdToImpersonate: user.id }),
    });

    if (response.ok) {
      window.location.href = "/";
    } else {
      alert("Error impersonating user");
      setLoadingImpersonation(undefined);
    }
  };

  const postFilters = [
    <TextInput key="1" label="Search Name" source="name" alwaysOn />,
    <TextInput key="2" label="Search Email" source="email" alwaysOn />,
  ];

  return (
    <Admin dataProvider={dataProvider("/api/admin", {})}>
      <Resource
        name="user"
        list={
          <List filters={postFilters}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="name" />
              <TextField source="email" />
              <DateField source="created_at" />
              <DateField source="updated_at" />
              <EditButton label="Edit" />
              <FunctionField
                label="Name"
                render={(user: User) =>
                  loadingImpersonation === user.id ? (
                    "Loading..."
                  ) : (
                    <Button
                      onClick={() => void handleImpersonation(user)}
                      label="Login as User"
                    />
                  )
                }
              />
            </Datagrid>
          </List>
        }
        edit={EditGuesser}
        recordRepresentation="name"
      />
      <Resource
        name="organization"
        list={ListGuesser}
        edit={EditGuesser}
        recordRepresentation="name"
      />
      <Resource
        name="team"
        list={ListGuesser}
        edit={EditGuesser}
        recordRepresentation="name"
      />
      <Resource
        name="project"
        list={ListGuesser}
        edit={EditGuesser}
        recordRepresentation="name"
      />
    </Admin>
  );
};

export default AdminApp;
