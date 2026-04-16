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
  SingleFieldList,
  ArrayField,
  ReferenceField,
  BooleanInput,
} from "react-admin";
import { dataProvider } from "ra-data-simple-prisma";
import type { User } from "@prisma/client";
import { PlanTypes, SubscriptionStatus } from "@prisma/client";
import { useState } from "react";

interface AdminAppProps {
  /**
   * Basename passed to react-admin's <Admin>, used when mounting the same
   * component at a non-default URL (e.g. "/ops/backoffice" in addition to
   * "/admin"). Defaults to "/admin" for backwards compatibility with the
   * original /admin entry point.
   */
  basename?: string;
}

const AdminApp = ({ basename = "/admin" }: AdminAppProps = {}) => {
  const [loadingImpersonation, setLoadingImpersonation] = useState<
    string | undefined
  >();

  const handleImpersonation = async (user: User) => {
    const reason = prompt(
      "Reason for impersonating this user (saved to audit logs)"
    );
    if (!reason) {
      return;
    }

    setLoadingImpersonation(user.id);
    try {
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userIdToImpersonate: user.id,
          reason: reason,
        }),
      });

      if (response.ok) {
        window.location.href = "/";
      } else {
        alert("Error impersonating user");
        setLoadingImpersonation(undefined);
      }
    } catch {
      alert("Error impersonating user");
      setLoadingImpersonation(undefined);
    }
  };

  const postFilters = [
    <TextInput key="1" label="Search" source="query" alwaysOn />,
  ];

  return (
    <Admin dataProvider={dataProvider("/api/admin", {})} basename={basename}>
      <Resource
        name="user"
        list={
          <List filters={postFilters}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="name" />
              <TextField source="email" />

              <ArrayField source="orgMemberships" label="Organizations">
                <SingleFieldList>
                  <ReferenceField
                    label="Organization"
                    source="organizationId"
                    reference="organization"
                  />
                </SingleFieldList>
              </ArrayField>

              <ArrayField source="teamMemberships" label="Projects">
                <SingleFieldList>
                  <ArrayField source="team.projects" label="Projects">
                    <SingleFieldList resource="project">
                      <TextField source="name" />
                    </SingleFieldList>
                  </ArrayField>
                </SingleFieldList>
              </ArrayField>

              <DateField source="createdAt" locales="nl" />
              <DateField source="lastLoginAt" locales="nl" showTime />
              <DateField source="deactivatedAt" locales="nl" showTime />
              <EditButton label="Edit" />
              <FunctionField
                label="Impersonate"
                render={(user: User) =>
                  loadingImpersonation === user.id ? (
                    "Loading..."
                  ) : (
                    <Button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void handleImpersonation(user);
                      }}
                      label="Login as User"
                    />
                  )
                }
              />
            </Datagrid>
          </List>
        }
        edit={UserEdit}
        recordRepresentation="name"
      />
      <Resource
        name="organization"
        list={
          <List filters={postFilters}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="name" />
              <TextField source="slug" />
              <DateField source="createdAt" locales="nl" />
              <EditButton label="Edit" />
            </Datagrid>
          </List>
        }
        edit={EditGuesser}
        recordRepresentation="name"
      />

      <Resource
        name="project"
        list={
          <List filters={postFilters}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="name" />
              <TextField source="slug" />
              <DateField source="createdAt" locales="nl" />
              <EditButton label="Edit" />
            </Datagrid>
          </List>
        }
        edit={EditGuesser}
        recordRepresentation="name"
      />
      <Resource
        name="subscription"
        list={
          <List filters={postFilters}>
            <Datagrid>
              <TextField source="id" />
              <TextField source="plan" />
              <TextField source="status" />
              <TextField source="stripeSubscriptionId" />
              <ReferenceField
                source="organizationId"
                reference="organization"
              />
              <DateField source="startDate" locales="nl" />
              <DateField source="endDate" locales="nl" />
              <EditButton label="Edit" />
            </Datagrid>
          </List>
        }
        edit={SubscriptionEdit}
        recordRepresentation="name"
        hasCreate={true}
        create={SubscriptionCreate}
      />
      <Resource
        name="organizationFeature"
        list={ListGuesser}
        edit={OrganizationFeatureEdit}
        recordRepresentation="name"
        hasCreate={true}
        create={OrganizationFeatureCreate}
      />
    </Admin>
  );
};

export default AdminApp;

const UserEdit = () => (
  <Edit>
    <SimpleForm>
      <TextInput source="name" label="Name" />
      <TextInput source="email" label="Email" />
      <DateInput
        source="deactivatedAt"
        label="Deactivated At (set to deactivate, clear to reactivate)"
        parse={(val) => (val ? new Date(val).toISOString() : null)}
      />
      <BooleanInput
        source="pendingSsoSetup"
        label="Pending SSO Setup (enable to allow SSO provider linking)"
      />
    </SimpleForm>
  </Edit>
);

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
        label="Max Traces Per Month"
        type="number"
      />
      <NumberInput
        source="evaluationsCredit"
        label="Evaluations Credit"
        type="number"
      />
      <NumberInput source="maxWorkflows" label="Max Workflows" type="number" />
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
      <OrganizationFeatureFormElements />
    </SimpleForm>
  </Create>
);

const OrganizationFeatureEdit = () => (
  <Edit>
    <SimpleForm>
      <OrganizationFeatureFormElements />
    </SimpleForm>
  </Edit>
);

const OrganizationFeatureFormElements = () => (
  <>
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
        filterToQuery={(searchText) => ({ name: searchText })}
      />
    </ReferenceInput>
    <DateInput
      source="trialEndDate"
      label="Trial End Date"
      parse={(val) => (val ? new Date(val).toISOString() : null)}
    />
  </>
);
