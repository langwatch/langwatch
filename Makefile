infra-init:
	@cd langevals && \
	make install && \
	poetry run python ../infrastructure/scripts/generate_lambdas.py
	@terraform -chdir=infrastructure/ init

infra-plan:
	@terraform -chdir=infrastructure/ plan

# Required dependencies: terraform, aws, git, plus ~/.aws/credentials must be set up
infra-apply:
	@terraform -chdir=infrastructure/ apply -auto-approve

deploy: infra-apply
	@profile=$$(sed -n 's/.*value *= *"\(lw-[^"]*\)".*/\1/p' infrastructure/variables/outputs.tf) && \
	region=eu-central-1 && \
	TASK_DEFINITION=$$(aws ecs describe-task-definition --profile $$profile --region $$region --task-definition=langwatch-task) && \
	TASK_DEF_ARN=$$(echo $$TASK_DEFINITION | jq '.taskDefinition.taskDefinitionArn' | sed 's#"##g') && \
	TASK_CONTAINER_NAME=$$(echo $$TASK_DEFINITION | jq '.taskDefinition.containerDefinitions[0].name' | sed 's#"##g') && \
	TASK_CONTAINER_PORT=$$(echo $$TASK_DEFINITION | jq '.taskDefinition.containerDefinitions[0].portMappings[0].containerPort' | sed 's#"##g') && \
	APP_SPEC=$$(cat ./infrastructure/appspec.json | jq ".Resources[0].TargetService.Properties.TaskDefinition = \"$$TASK_DEF_ARN\"") && \
	APP_SPEC=$$(echo $$APP_SPEC | jq ".Resources[0].TargetService.Properties.LoadBalancerInfo.ContainerName = \"$$TASK_CONTAINER_NAME\"") && \
	APP_SPEC=$$(echo $$APP_SPEC | jq ".Resources[0].TargetService.Properties.LoadBalancerInfo.ContainerPort = \"$$TASK_CONTAINER_PORT\"") && \
	echo "App Spec: " && \
	echo $$APP_SPEC | jq && \
	APP_SPEC=$$(echo $$APP_SPEC | jq -r tostring) && \
	REVISION_TMPL='{"revisionType":"AppSpecContent","appSpecContent":{"content":$$app_spec}}' && \
	REVISION=$$(echo "{}" | jq --arg app_spec "$$APP_SPEC" ". + $$REVISION_TMPL") && \
	deploy_id=$$(aws deploy --profile $$profile --region $$region create-deployment \
		--application-name "langwatch-app" \
		--deployment-group-name "langwatch-dg" \
		--deployment-config-name "CodeDeployDefault.ECSAllAtOnce" \
		--description "Deploying new version" \
		--revision "$$REVISION" \
		--query "deploymentId" \
		--output text); \
	echo "Deployment ID: $$deploy_id" && \
	aws deploy --profile $$profile --region $$region wait deployment-successful --deployment-id $$deploy_id