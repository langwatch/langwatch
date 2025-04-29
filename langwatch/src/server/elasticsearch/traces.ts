interface ProjectConnectionConfig {
  projectId: string;
}
interface OrganizationConnectionConfig {
  organizationId: string;
}
interface TestConnectionConfig {
  test: true;
}

type ConnectionConfig = ProjectConnectionConfig | OrganizationConnectionConfig | TestConnectionConfig;
