infra-init:
	@cd langevals && \
	make install && \
	poetry run python ../infrastructure/scripts/generate_lambdas.py
	@terraform -chdir=infrastructure/ init

infra-plan:
	@terraform -chdir=infrastructure/ plan

# Required dependencies: terraform, aws, git, plus ~/.aws/credentials must be set up
infra-apply:
	@terraform -chdir=infrastructure/ apply