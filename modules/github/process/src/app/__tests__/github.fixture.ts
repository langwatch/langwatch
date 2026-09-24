import {
  type GithubApi,
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

export class TestGithubService implements GithubApi {
  readonly configured = true;
  readonly mappingRequests: MappingRequest[] = [];
  mappingError: Error | null = null;

  static create(host = "github.com"): TestGithubService {
    return new TestGithubService(host);
  }

  private constructor(private readonly host: string) {}

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

  async consumeInstallNonce(): Promise<"consumed" | "spent" | "unavailable"> {
    return "consumed";
  }

  signInstallState(): string {
    return "state";
  }

  parseInstallState(): GithubInstallStatePayload | null {
    return null;
  }

  popupResponseHtml(): string {
    return "";
  }

  popupErrorHtml(): string {
    return "";
  }

  parsePullRequestEvent(): GithubPullRequestEvent | null {
    return null;
  }

  async applyWebhookPayload(): Promise<void> {}

  async getAllForOrganization(): Promise<readonly GithubInstallation[]> {
    return [];
  }

  async findByInstallationId(): Promise<GithubInstallation | null> {
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

  async mintTurnToken(): Promise<GithubTurnToken | null> {
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

  async findByNumber(): Promise<GithubPullRequest | null> {
    return null;
  }

  async recheckDueBranches(): Promise<number> {
    return 0;
  }

  async countUsage(): Promise<{ pullRequests: number }> {
    return { pullRequests: 0 };
  }

  async pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return { branchChecks: 0 };
  }
}
