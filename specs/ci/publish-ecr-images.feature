Feature: Publish every deployable image to the artifacts registry
  As the team that deploys LangWatch Cloud
  I want every image built from this repository published to the artifacts registry under its commit tag
  So that the deployment pins one commit of this repository and builds nothing from its source itself

  # These scenarios describe .github/workflows/publish-docker-ecr.yml. A
  # workflow is not something the test suites can run, so they are validated by
  # actionlint on the pull request and by the first run on main, not by bound
  # tests.

  @unimplemented
  Scenario: Service images are published as an index under the commit tag
    Given a merge to main changes the source of the langy agent
    When publish-docker-ecr runs for that commit
    Then langwatch-langy-agent has a git-<short sha> tag
    And that tag is an image index over an arm64 manifest

  @unimplemented
  Scenario: Lambda images are published as a single manifest
    Given a merge to main changes the NLP engine or the evaluators
    When publish-docker-ecr runs for that commit
    Then langwatch-nlp-lambda and each langwatch-eval-<package> image has a git-<short sha> tag
    And that tag is a single arm64 manifest, because a Lambda function image cannot be an index

  @unimplemented
  Scenario: An image the commit did not change still gets the commit tag
    Given a merge to main changes nothing the evaluator images are built from
    When publish-docker-ecr runs for that commit
    Then each langwatch-eval-<package> image gets the git-<short sha> tag of that commit
    And the tag names the manifest the image already had, with no rebuild

  @unimplemented
  Scenario: A failed Lambda build does not hold back the service images
    Given the build of one evaluator image fails
    When publish-docker-ecr finishes for that commit
    Then the service images still have their git-<short sha> tags
    And the run fails, naming the evaluator image that was not published
