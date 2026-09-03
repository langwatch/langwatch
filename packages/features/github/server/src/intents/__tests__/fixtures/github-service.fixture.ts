import {
  GithubService,
  type GithubAppConfig,
  type GithubConnectionStatus,
  type GithubDisconnectResult,
  type GithubInstallation,
  type GithubInstallStatePayload,
  type GithubPullRequest,
  type GithubPullRequestEvent,
  type GithubPullRequestLiveStatus,
  type GithubRepositoryRef,
  type GithubTurnToken,
} from "@langwatch/github-contract";

type MappingRequest = {
  tenantId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
};

export class TestGithubService extends GithubService {
  readonly configured = true;
  readonly mappingRequests: MappingRequest[] = [];
  mappingError: Error | null = null;

  static create(host = "github.com"): TestGithubService {
    return new TestGithubService(host);
  }

  private constructor(private readonly host: string) {
    super();
  }

  getAppConfig(): GithubAppConfig {
    return { appSlug: "test", webhookSecret: "test", configured: true };
  }

  getWebBase(): string {
    return `https://${this.host}`;
  }

  normalizeRepositoryHost(repositoryHost: string): string {
    return repositoryHost.toLowerCase() || this.host;
  }

  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.normalizeRepositoryHost(repositoryHost) === this.host;
  }

  getAppInstallUrl(): string {
    return `${this.getWebBase()}/install`;
  }

  getInstallStateTtlMs(): number {
    return 0;
  }

  async registerInstallNonce(): Promise<boolean> {
    return true;
  }

  async tryConsumeInstallNonce(): Promise<boolean | null> {
    return true;
  }

  signInstallState(): string {
    return "state";
  }

  tryVerifyInstallState(): GithubInstallStatePayload | null {
    return null;
  }

  popupResponseHtml(): string {
    return "";
  }

  popupErrorHtml(): string {
    return "";
  }

  tryParsePullRequestEvent(): GithubPullRequestEvent | null {
    return null;
  }

  async getAllForOrganization(): Promise<readonly GithubInstallation[]> {
    return [];
  }

  async tryGetByInstallationId(): Promise<GithubInstallation | null> {
    return null;
  }

  async isOrganizationMember(): Promise<boolean> {
    return false;
  }

  async getConnectionStatus(): Promise<GithubConnectionStatus> {
    return { configured: true, connected: false, installations: [], installUrl: null };
  }

  async disconnect(): Promise<GithubDisconnectResult> {
    return { uninstallUrl: `${this.getWebBase()}/settings/installations/test` };
  }

  async recordInstallation(): Promise<{ accountLogin: string }> {
    return { accountLogin: "test" };
  }

  async handleWebhookEvent(): Promise<void> {}

  async listRepositoriesForOrganization(): Promise<readonly GithubRepositoryRef[]> {
    return [];
  }

  async tryMintTurnToken(): Promise<GithubTurnToken | null> {
    return null;
  }

  async coversRepository(): Promise<boolean> {
    return false;
  }

  async requestBranchMapping(input: MappingRequest): Promise<void> {
    this.mappingRequests.push(input);
    if (this.mappingError !== null) throw this.mappingError;
  }

  async getLivePullRequestStatuses(): Promise<readonly GithubPullRequestLiveStatus[]> {
    return [];
  }

  async applyPullRequestEvent(): Promise<boolean> {
    return false;
  }

  async findForBranches(): Promise<readonly GithubPullRequest[]> {
    return [];
  }

  async findAllByBranches(): Promise<readonly GithubPullRequest[]> {
    return [];
  }

  async tryFindByNumber(): Promise<GithubPullRequest | null> {
    return null;
  }

  async recheckDueBranches(): Promise<number> {
    return 0;
  }

  async pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return { branchChecks: 0 };
  }
}
