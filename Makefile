infra-generate:
	@cd langevals && \
	make install && \
	poetry run python ../infrastructure/scripts/generate_lambdas.py

infra-init:
	@terraform -chdir=infrastructure/ init -reconfigure

infra-plan:
	@terraform -chdir=infrastructure/ plan

# Required dependencies: terraform, aws, git, plus ~/.aws/credentials must be set up
infra-apply:
	@terraform -chdir=infrastructure/ apply

infra-apply-approve:
	@terraform -chdir=infrastructure/ apply -auto-approve

kubeconfig:
	@aws eks --profile lw-prod --region eu-central-1 update-kubeconfig --name langwatch-cluster

port-forward: kubeconfig
	@./scripts/prod-port-forward.sh
