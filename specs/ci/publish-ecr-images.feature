Feature: Publish every deployable image to the artifacts registry
  As the team that deploys LangWatch Cloud
  I want every image built from this repository published to the artifacts registry under its commit tag
  So that the deployment pins one commit of this repository and builds nothing from its source itself

  # These scenarios describe .github/workflows/publish-docker-ecr.yml. How a
  # Lambda image gets its tag is .github/scripts/publish-lambda-tag.sh, bound
  # by .github/scripts/__tests__/publish-lambda-tag.test.sh. The rest is the
  # workflow's own build steps, which no test suite can run: those scenarios
  # are @unimplemented and are proved by the first run on main.

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

  @unit
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

  @unit
  Scenario: A Lambda image whose build did not push its tag fails the run
    Given an evaluator image was due to be built and has no git-<short sha> tag
    When publish-docker-ecr publishes that image
    Then it fails, naming the evaluator image that was not published
    And it does not fall back to an older image

  @unit
  Scenario: A Lambda image with no earlier image is left unpublished with a warning
    Given an evaluator image has no git-<sha> tag at all
    When publish-docker-ecr re-tags that image for a commit that did not change it
    Then it warns that the image needs a dispatch run to be seeded
    And it writes no tag and does not fail

  @unit
  Scenario: A tag that cannot be written fails the run
    Given the registry refuses to write the commit tag for an evaluator image
    When publish-docker-ecr re-tags that image
    Then it fails and shows the registry's error

  @unit
  Scenario: A Lambda image is never re-tagged from an index
    Given the newest git-<sha> tag of an evaluator image is an image index
    When publish-docker-ecr re-tags that image for a commit that did not change it
    Then it fails instead of writing the commit tag

  @unit
  Scenario: A release also tags each Lambda image with its version
    Given a langwatch@v<version> release
    When publish-docker-ecr publishes a Lambda image
    Then the image also gets the <version> tag, naming the same manifest
