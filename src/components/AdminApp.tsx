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
  Create,
  SimpleForm,
  NumberInput,
  DateInput,
  SelectInput,
  Edit,
  ReferenceInput,
  AutocompleteInput,
  required,
} from "../../langwatch/langwatch/node_modules/react-admin";
import { dataProvider } from "ra-data-simple-prisma";
import type { User } from "@prisma/client";
import { PlanTypes, SubscriptionStatus } from "@prisma/client";
// @ts-ignore
import { useState } from "../../langwatch/langwatch/node_modules/react";

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
      <Resource
        name="subscription"
        list={ListGuesser}
        edit={SubscriptionEdit}
        recordRepresentation="name"
        hasCreate={true}
        create={SubscriptionCreate}
        // add a add button to create a new subscription
      />
      <Resource
        name="organizationFeature"
        list={ListGuesser}
        edit={EditGuesser}
        recordRepresentation="name"
        hasCreate={true}
        create={OrganizationFeatureCreate}
      />
    </Admin>
  );
};

export default AdminApp;

const SubscriptionFromElements = () => {
  return (
    <>
      <ReferenceInput
        source="organizationId"
        reference="organization"
        perPage={100}
        sort={{ field: "name", order: "ASC" }}
      >
        <AutocompleteInput
          optionText="name"
          label="Organization"
          validate={required()}
          filterToQuery={(searchText) => ({ name: searchText })}
        />
      </ReferenceInput>
      <SelectInput
        source="plan"
        label="Plan"
        choices={Object.values(PlanTypes).map((plan) => ({
          id: plan,
          name: plan,
        }))}
      />
      <TextInput source="stripeSubscriptionId" label="Stripe Subscription ID" />
      <SelectInput
        source="status"
        label="Status"
        choices={Object.values(SubscriptionStatus).map((status) => ({
          id: status,
          name: status,
        }))}
      />
      <DateInput
        source="startDate"
        label="Start Date"
        parse={(val) => (val ? new Date(val).toISOString() : null)}
      />
      <DateInput
        source="endDate"
        label="End Date"
        parse={(val) => (val ? new Date(val).toISOString() : null)}
      />

      <NumberInput source="maxMembers" label="Max Members" type="number" />
      <NumberInput source="maxProjects" label="Max Projects" type="number" />
      <NumberInput
        source="maxMessagesPerMonth"
        label="Max Messages Per Month"
        type="number"
      />
    </>
  );
};

const SubscriptionCreate = () => (
  <Create>
    <SimpleForm>
      <SubscriptionFromElements />
    </SimpleForm>
  </Create>
);

const SubscriptionEdit = () => (
  <Edit>
    <SimpleForm>
      <SubscriptionFromElements />
    </SimpleForm>
  </Edit>
);

const OrganizationFeatureCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput
        source="feature"
        label="Feature"
        isRequired={true}
        validate={(value) => {
          if (!value) return "Feature is required";
          return undefined;
        }}
      />
      <ReferenceInput
        source="organizationId"
        reference="organizations"
        perPage={100}
        sort={{ field: "name", order: "ASC" }}
      >
        <AutocompleteInput
          optionText="name"
          label="Organization"
          validate={required()}
          filterToQuery={(searchText) => ({ name: searchText })} // Improve filtering
        />
      </ReferenceInput>
    </SimpleForm>
  </Create>
);
