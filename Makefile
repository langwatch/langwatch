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

deploy: #infra-init infra-apply # TODO get the profile and region from variables file
	@export TASK_DEF_ARN=$$(aws ecs describe-task-definition --profile lw-prod --region eu-central-1 --task-definition=langwatch-task | jq '.taskDefinition.taskDefinitionArn' | sed 's#"##g'); \
	aws deploy --profile lw-prod --region eu-central-1 create-deployment \
		--application-name "langwatch-app" \
		--deployment-group-name "langwatch-dg" \
		--deployment-config-name "CodeDeployDefault.ECSAllAtOnce" \
		--description "Deploying new version" \
		--revision "{\"revisionType\":\"AppSpecContent\",\"appSpecContent\":{\"content\":\"{\\\"version\\\":1,\\\"Resources\\\":[{\\\"TargetService\\\":{\\\"Type\\\":\\\"AWS::ECS::Service\\\",\\\"Properties\\\":{\\\"TaskDefinition\\\":\\\"$$TASK_DEF_ARN\\\"}}}]}\"}}" \
		--query "deploymentId" \
		--output text